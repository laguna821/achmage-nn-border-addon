// End-to-end smoke test against the test Obsidian started by setup-vault.sh.
// Checks that group/folder borders render in the real Notebook Navigator and
// that colors follow light/dark mode, then saves screenshots to work/shots.
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
    const root = document.querySelector('.nn-navigation-pane .nn-navitem[data-path="/"]');
    if (root && root.getAttribute("aria-expanded") !== "true") root.querySelector(".nn-navitem-chevron")?.click();
    await sleep(1500);
    const rect = pane()?.getBoundingClientRect();
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, 520) } : null;
  });
  check(layout && layout.x >= 0, "Notebook Navigator folder tree is visible");

  const snapshot = (theme) =>
    run(async (theme) => {
      app.changeTheme(theme);
      await new Promise((r) => setTimeout(r, 1500));
      const boxes = Array.from(document.querySelectorAll(".ach-nn-folder-border-box"));
      return {
        dark: document.body.classList.contains("theme-dark"),
        groupBoxes: boxes.filter((b) => b.classList.contains("ach-nn-group-border-box")).length,
        folderBoxes: boxes.filter((b) => !b.classList.contains("ach-nn-group-border-box")).length,
        stops: boxes.map((b) => Array.from(b.querySelectorAll("stop")).map((s) => s.getAttribute("stop-color")).join("→")),
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
  console.log(`screenshots: ${SHOTS}`);
} finally {
  client.close();
}
process.exit(failures.length ? 1 : 0);
