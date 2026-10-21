// End-to-end smoke test against the test Obsidian started by setup-vault.sh
// (or setup-vault.ps1). Checks that group/folder borders and light/dark folder
// colors render in the real Notebook Navigator and follow the theme, then
// saves screenshots to work/shots.
//
//   node dev/e2e/smoke.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./cdp.mjs";

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "work", "shots");
const ADDON = "achmage-nn-border-addon";

const client = await connect();
const run = (fn, ...args) => client.evaluate(`(${fn})(...${JSON.stringify(args)})`);
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
};

try {
  // Trust the vault's plugins on first open, then give the window a real size.
  await run(async (addon) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 40 && !document.querySelector(".modal-container button, .workspace"); i++) await sleep(250);
    document.querySelector(".modal-container button:not(.mod-cancel)")?.click();
    for (let i = 0; i < 40 && !app.plugins.plugins[addon]; i++) await sleep(250);
    require("@electron/remote").getCurrentWindow().setSize(1400, 900);
    await sleep(500);
  }, ADDON);

  // Open Notebook Navigator on its folder tree with the vault root expanded.
  const layout = await run(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    app.workspace.leftSplit.expand();
    await app.commands.executeCommandById("notebook-navigator:open");
    await sleep(2500);
    const pane = () => document.querySelector(".nn-navigation-pane");
    if (pane() && pane().getBoundingClientRect().left < 0) {
      // Single-pane sidebar showing the file list: its first header button returns to the tree.
      document.querySelector(".nn-list-pane .nn-icon-button")?.click();
      await sleep(1200);
    }
    const expand = async (path) => {
      const row = document.querySelector(`.nn-navigation-pane .nn-navitem[data-path="${path}"]`);
      if (row && row.getAttribute("aria-expanded") !== "true") row.querySelector(".nn-navitem-chevron")?.click();
      await sleep(1500);
    };
    await expand("/");
    await expand("10. Data (D)"); // its subfolders inherit the folder colors
    const rect = pane()?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, 520) } : null;
  });
  check(layout && layout.x >= 0, "Notebook Navigator folder tree is visible");

  const snapshot = (theme) =>
    run(async (theme) => {
      app.changeTheme(theme);
      await new Promise((r) => setTimeout(r, 1500));
      const boxes = Array.from(document.querySelectorAll(".ach-nn-folder-border-box"));
      // What the folder rows actually show, next to Notebook Navigator's own inline color.
      const folders = {};
      for (const path of ["10. Data (D)", "10. Data (D)/101. Fleeting", "40. Meaning (M)", "70. Documentations", "20. Information (I)"]) {
        const row = document.querySelector(`.nn-navigation-pane .nn-navitem.nn-folder[data-path="${path}"]`);
        const name = row?.querySelector(".nn-navitem-name");
        if (!name) continue;
        const before = getComputedStyle(row, "::before");
        const probe = document.createElement("span");
        probe.style.color = name.style.color;
        document.body.appendChild(probe);
        const inline = name.style.color ? getComputedStyle(probe).color : null;
        probe.remove();
        folders[path] = {
          name: getComputedStyle(name).color,
          icon: getComputedStyle(row.querySelector(".nn-navitem-icon") ?? name).color,
          nn: inline,
          background: before.content === "none" ? null : before.backgroundColor,
        };
      }
      return {
        dark: document.body.classList.contains("theme-dark"),
        groupBoxes: boxes.filter((b) => b.classList.contains("ach-nn-group-border-box")).length,
        folderBoxes: boxes.filter((b) => !b.classList.contains("ach-nn-group-border-box")).length,
        stops: boxes.map((b) => Array.from(b.querySelectorAll("stop")).map((s) => s.getAttribute("stop-color")).join("→")),
        folders,
      };
    }, theme);

  fs.mkdirSync(SHOTS, { recursive: true });
  const shots = {};
  for (const [theme, label] of [["moonstone", "light"], ["obsidian", "dark"]]) {
    shots[label] = await snapshot(theme);
    if (layout) {
      const { data } = await client.send("Page.captureScreenshot", { format: "png", clip: { ...layout, scale: 2 } });
      fs.writeFileSync(path.join(SHOTS, `${label}.png`), Buffer.from(data, "base64"));
    }
  }

  check(shots.light.groupBoxes >= 3, `group blocks rendered (light: ${shots.light.groupBoxes})`);
  check(shots.light.folderBoxes >= 1, `folder border rendered (light: ${shots.light.folderBoxes})`);
  check(shots.dark.groupBoxes === shots.light.groupBoxes, "same blocks in dark mode");
  check(shots.dark.dark && !shots.light.dark, "theme switched between light and dark");
  check(JSON.stringify(shots.light.stops) !== JSON.stringify(shots.dark.stops), "border colors follow the theme");
  console.log("light:", shots.light.stops.join("  "));
  console.log("dark: ", shots.dark.stops.join("  "));

  // Folder colors from demo-data.json (folderColorOverrides).
  const light = shots.light.folders;
  const dark = shots.dark.folders;
  const data = "10. Data (D)";
  const sub = "10. Data (D)/101. Fleeting";
  check(light[data]?.name === "rgb(47, 147, 100)" && light[data]?.icon === "rgb(47, 147, 100)", `light text override (${light[data]?.name})`);
  check(dark[data]?.name === "rgb(97, 214, 155)", `dark text override (${dark[data]?.name})`);
  check(dark[data]?.background === "rgb(27, 43, 39)", `dark-only background (${dark[data]?.background})`);
  check(!light[data]?.background || light[data].background === "rgba(0, 0, 0, 0)", `no background in light (${light[data]?.background})`);
  check(light[sub]?.name === light[data]?.name && dark[sub]?.background === dark[data]?.background, "subfolder inherits the overrides");
  // These compare against Notebook Navigator's own color, so SOURCE_VAULT must color them.
  const nnColored = (folders, path) => {
    const ok = Boolean(folders[path]?.nn);
    if (!ok) check(false, `"${path}" needs a Notebook Navigator color in SOURCE_VAULT for this check`);
    return ok;
  };
  const meaning = "40. Meaning (M)";
  if (nnColored(light, meaning) && nnColored(dark, meaning)) {
    check(light[meaning].name === "rgb(190, 78, 117)", `light override on a folder Notebook Navigator colors (${light[meaning].name})`);
    check(dark[meaning].name === dark[meaning].nn, `dark keeps Notebook Navigator's color (${dark[meaning].name})`);
  }
  const docs = "70. Documentations";
  if (nnColored(light, docs) && nnColored(dark, docs)) {
    check(light[docs].name !== light[docs].nn, `"none" removes the color in light (${light[docs].name})`);
    check(dark[docs].name === dark[docs].nn, `...and keeps it in dark (${dark[docs].name})`);
  }
  const untouched = "20. Information (I)";
  for (const [label, folders] of [["light", light], ["dark", dark]]) {
    if (nnColored(folders, untouched)) {
      check(folders[untouched].name === folders[untouched].nn, `folders without overrides are unchanged in ${label} (${folders[untouched].name})`);
    }
  }
  console.log("folder colors:", JSON.stringify({ light, dark }, null, 2));
  console.log(`screenshots: ${SHOTS}`);
} finally {
  client.close();
}
process.exit(failures.length ? 1 : 0);
