"use strict";
// Regression + feature tests for achmage-nn-border-addon.
// Run from the repo root: npm test   (or: node --test dev/test/)
//
// main.js is loaded with its internal functions exposed, and compared against
// the v0.1.0 minified build (fixtures/v0.1.0-main.js) to prove the rewrite
// kept the original behaviour.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const REPO = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures");
const obsidianStub = require("./obsidian-stub");

function loadWithInternals(file, exportsExpr) {
  const source = fs.readFileSync(file, "utf8") + `\n;module.exports.__internals = ${exportsExpr};\n`;
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod.require = (id) => (id === "obsidian" ? obsidianStub : Module.prototype.require.call(mod, id));
  mod._compile(source, file);
  return mod.exports;
}

const original = loadWithInternals(
  path.join(FIXTURES, "v0.1.0-main.js"),
  "{N,M,T,W,w,U,F,Ee,Q,te,re,ne,ae,me,fe,he,pe,K,V}",
).__internals;
const nextModule = loadWithInternals(
  path.join(REPO, "main.js"),
  `{clampInset,clampRadius,resolveGeometry,compactBorderStyle,readGeometryDefaults,normalizeBorderStyle,
    normalizeHexColor,normalizeFolderBorders,normalizeBorderGroups,pushRecentColors,renameFolderKeys,removeFolderKeys,
    renameGroupFolders,removeGroupFolders,gradientVector,borderPath,borderedFolderPaths,boxFromRows,collectRuns,
    isSameOrDescendant,loadSettings,resolveThemeColors,buildGroupBoxes,buildFolderBoxes,FOLDER_GEOMETRY,GROUP_GEOMETRY,
    AchmageNnBorderAddon,DEFAULT_SETTINGS}`,
);
const next = nextModule.__internals;

// Deterministic PRNG so failures are reproducible.
let seed = 20261015;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = (items) => items[Math.floor(rand() * items.length)];
const randNum = (min, max) => min + rand() * (max - min);

function fakeComputed(vars) {
  return { getPropertyValue: (name) => (name in vars ? String(vars[name]) : "") };
}

// ---------------------------------------------------------------------------
// Behaviour parity with the original minified build
// ---------------------------------------------------------------------------

test("clamp helpers match original", () => {
  for (let i = 0; i < 2000; i++) {
    const value = randNum(-40, 40);
    assert.equal(next.clampInset(value), original.N(value));
    assert.equal(next.clampRadius(value), original.M(value));
  }
});

test("hex normalization matches original", () => {
  for (const value of ["#ABC", "#aabbcc", " #AbCdEf ", "#abcd", "red", "", "#12", "#1234567", "#fff"]) {
    assert.equal(next.normalizeHexColor(value), original.F(value));
  }
});

const STYLE_INPUTS = [
  "#abc",
  "#AABBCC",
  "nope",
  null,
  42,
  { startColor: "#123456" },
  { startColor: "#123456", endColor: "#abc", insetX: 3, insetY: "-2", radius: 30 },
  { startColor: "#123456", endColor: "bad", insetX: "x", insetY: 99, radius: -5 },
  { startColor: "bad" },
  { endColor: "#123456" },
  { startColor: "#ffb2cb", endColor: null, insetX: 0, radius: 6 },
];

test("style normalization matches original for shared fields", () => {
  for (const input of STYLE_INPUTS) {
    const before = original.U(input);
    const after = next.normalizeBorderStyle(input);
    if (before === null) {
      assert.equal(after, null, JSON.stringify(input));
      continue;
    }
    const { darkStartColor, darkEndColor, ...shared } = after;
    assert.deepEqual(shared, before, JSON.stringify(input));
    assert.equal(darkStartColor, null);
    assert.equal(darkEndColor, null);
  }
});

test("geometry resolve + compaction match original", () => {
  const defaults = { insetX: 1, insetY: 1, radius: 14 };
  for (const input of STYLE_INPUTS) {
    const style = original.U(input);
    if (!style) continue;
    assert.deepEqual(next.resolveGeometry(style, defaults), original.T(style, defaults));
    assert.deepEqual(next.compactBorderStyle(style, defaults), original.W(style, defaults));
  }
  assert.deepEqual(next.resolveGeometry(null, defaults), original.T(null, defaults));
});

test("Style Settings defaults read like original", () => {
  const cases = [
    {},
    { "--ach-nn-border-inset-x": "3px", "--ach-nn-border-inset-y": "-2px", "--ach-nn-border-radius": "20px" },
    { "--ach-nn-border-pad-x": "4px", "--ach-nn-border-pad-y": "5px" },
    { "--ach-nn-border-inset-x": "garbage", "--ach-nn-border-pad-x": "7px", "--ach-nn-border-radius": "99px" },
  ];
  for (const vars of cases) {
    assert.deepEqual(next.readGeometryDefaults(fakeComputed(vars), next.FOLDER_GEOMETRY), original.w(fakeComputed(vars)));
  }
});

test("gradient vectors match original", () => {
  for (let i = 0; i < 2000; i++) {
    const width = randNum(4, 400);
    const height = randNum(4, 400);
    const angle = Math.round(randNum(0, 360));
    const colors = { startColor: "#111111", endColor: pick([null, "#222222"]) };
    assert.deepEqual(next.gradientVector(width, height, angle, colors), original.ne(width, height, angle, colors));
  }
});

test("border paths match original byte for byte", () => {
  for (let i = 0; i < 5000; i++) {
    const width = randNum(0, 500);
    const height = randNum(0, 300);
    const radius = pick([0, 1, 6, 10, 14, 24, randNum(0, 24)]);
    const stroke = pick([1, 1.5, 2, 3, 4]);
    assert.equal(next.borderPath(width, height, radius, stroke), original.ae(width, height, radius, stroke));
  }
});

test("rename/delete of folder keys match original", () => {
  const map = { a: 1, "a/b": 2, "a/b/c": 3, ab: 4, "x/a": 5 };
  for (const [from, to] of [["a", "z"], ["a/b", "q"], ["ab", "a"], ["nope", "x"]]) {
    assert.deepEqual(next.renameFolderKeys(map, from, to), original.te(map, from, to));
  }
  for (const removed of ["a", "a/b", "ab", "x"]) {
    assert.deepEqual(next.removeFolderKeys(map, removed), original.re(map, removed));
  }
});

test("recent colors match original", () => {
  const settings = { recentBorderColors: ["#111111", "#222222", "#333333"] };
  const inputs = [["#222222"], ["#ABC", "#abc", "#444444"], [], ["bad"], Array.from({ length: 15 }, (_, i) => `#0000${String(i).padStart(2, "0")}`)];
  for (const colors of inputs) {
    assert.deepEqual(next.pushRecentColors(settings, colors), original.Q(settings, colors));
  }
});

// Rows emulate a contiguous folder tree (one row per 28px).
function treeRows(paths, { top = 0, left = 8, right = 240, height = 28 } = {}) {
  return paths.map((p, index) => ({
    path: p,
    top: top + index * height,
    bottom: top + (index + 1) * height,
    left: p ? left + (p.split("/").length - 1) * 0 : left,
    right,
  }));
}

test("folder boxes match original on a contiguous tree", () => {
  const paths = ["/", "00. DIKM", "10. Data (D)", "10. Data (D)/101", "10. Data (D)/101/x", "20. Info (I)", "30. Know", "90. Settings"];
  const borders = {
    "/": original.U("#ffb2cb"),
    "10. Data (D)": original.U({ startColor: "#a695a5", insetX: 0, radius: 6 }),
    "10. Data (D)/101": original.U("#123456"),
    "90. Settings": original.U("#8c909a"),
  };
  const rows = treeRows(paths);
  const originalPaths = original.me(rows, borders);
  assert.deepEqual(next.borderedFolderPaths(rows, borders, true), originalPaths);
  const defaults = { insetX: 1, insetY: 1, radius: 14 };
  for (const p of originalPaths) {
    const geometry = original.T(borders[p], defaults);
    const before = original.fe(p, rows, borders[p], geometry.insetX, geometry.insetY, geometry.radius, 2);
    const runs = next.collectRuns(rows, (rowPath) => next.isSameOrDescendant(p, rowPath));
    assert.equal(runs.length, 1);
    const after = next.boxFromRows(runs[0], geometry, 2);
    assert.deepEqual(after, { top: before.top, left: before.left, width: before.width, height: before.height });
  }
});

test("settings migration from a v0.1.0 (v3) data.json keeps every folder border", async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, "data-v3.json"), "utf8"));
  const fakePlugin = { loadData: async () => JSON.parse(JSON.stringify(raw)) };
  const before = await original.K(fakePlugin);
  const after = await next.loadSettings(fakePlugin);
  assert.equal(after.version, 4);
  assert.deepEqual(after.borderGroups, []);
  assert.equal(after.showFolderBorders, true);
  assert.equal(after.showGroupBorders, true);
  assert.equal(after.suppressNestedBorders, true);
  assert.deepEqual(after.recentBorderColors, before.recentBorderColors);
  assert.deepEqual(Object.keys(after.folderBorders), Object.keys(before.folderBorders));
  for (const [key, style] of Object.entries(after.folderBorders)) {
    const { darkStartColor, darkEndColor, ...shared } = style;
    assert.deepEqual(shared, before.folderBorders[key]);
  }
  // A fresh install still gets defaults.
  const empty = await next.loadSettings({ loadData: async () => null });
  assert.deepEqual(empty, { ...next.DEFAULT_SETTINGS, version: 4 });
});

// ---------------------------------------------------------------------------
// New behaviour: groups and dark-mode colors
// ---------------------------------------------------------------------------

const TREE = [
  "/",
  "01. Inbox",
  "10. Data (D)",
  "10. Data (D)/101. Fleeting",
  "20. Information (I)",
  "30. Knowledge (K)",
  "40. Meaning (M)",
  "50. Teaching Materials",
  "70. Documentations",
  "Cards",
];

test("contiguous grouped folders form one block, descendants included", () => {
  const rows = treeRows(TREE);
  const dikm = ["10. Data (D)", "20. Information (I)", "30. Knowledge (K)", "40. Meaning (M)"];
  const runs = next.collectRuns(rows, (p) => dikm.some((f) => next.isSameOrDescendant(f, p)));
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].map((row) => row.path), TREE.slice(2, 7));
  const box = next.boxFromRows(runs[0], { insetX: 0, insetY: 1, radius: 10 }, 2);
  assert.deepEqual(box, { top: 2 * 28 + 1, left: 8, width: 232, height: 5 * 28 - 2 });
});

test("a non-member folder in between splits the group into two blocks", () => {
  const rows = treeRows(TREE);
  const members = ["10. Data (D)", "30. Knowledge (K)"];
  const runs = next.collectRuns(rows, (p) => members.some((f) => next.isSameOrDescendant(f, p)));
  assert.deepEqual(
    runs.map((run) => run.map((row) => row.path)),
    [["10. Data (D)", "10. Data (D)/101. Fleeting"], ["30. Knowledge (K)"]],
  );
});

test("non-folder rows (tags, shortcuts) break a block; hidden members are simply skipped", () => {
  const rows = treeRows(["50. Teaching Materials", null, "70. Documentations", "Cards"]);
  const members = ["50. Teaching Materials", "70. Documentations", "80. References"];
  const runs = next.collectRuns(rows, (p) => members.some((f) => next.isSameOrDescendant(f, p)));
  assert.deepEqual(runs.map((run) => run.map((row) => row.path)), [["50. Teaching Materials"], ["70. Documentations"]]);
});

test("group boxes and folder boxes resolve light/dark colors", () => {
  const rows = treeRows(TREE);
  const tokens = {
    folderWidth: 1,
    groupWidth: 2,
    angle: 135,
    opacity: 0.8,
    folderGeometry: { insetX: 1, insetY: 1, radius: 14 },
    groupGeometry: { insetX: 0, insetY: 1, radius: 10 },
  };
  const groups = next.normalizeBorderGroups([
    {
      id: "dikm",
      name: "DIKM",
      folders: ["10. Data (D)", "20. Information (I)", "30. Knowledge (K)", "40. Meaning (M)"],
      style: { startColor: "#005BAC", endColor: "#00ADA9", darkStartColor: "#A695A5", darkEndColor: "#F27AA4" },
    },
    { id: "out", name: "Outputs", folders: ["50. Teaching Materials", "70. Documentations"], style: { startColor: "#B6A599" } },
    { id: "empty", name: "Empty", folders: [], style: { startColor: "#000000" } },
  ]);
  const light = next.buildGroupBoxes({ rows, indent: 0 }, groups, tokens, false);
  const dark = next.buildGroupBoxes({ rows, indent: 0 }, groups, tokens, true);
  assert.deepEqual(light.map((box) => [box.key, box.startColor, box.endColor, box.strokeWidth]), [
    ["group:dikm:0", "#005bac", "#00ada9", 2],
    ["group:out:0", "#b6a599", null, 2],
  ]);
  assert.deepEqual(dark.map((box) => [box.key, box.startColor, box.endColor]), [
    ["group:dikm:0", "#a695a5", "#f27aa4"],
    ["group:out:0", "#b6a599", null],
  ]);
  // Adjacent blocks don't overlap: 2px gap with insetY 1.
  const [dikmBox, outBox] = light;
  assert.equal(outBox.top - (dikmBox.top + dikmBox.height), 2);

  const settings = {
    folderBorders: { "/": next.normalizeBorderStyle({ startColor: "#0a85f0", darkStartColor: "#ffb2cb" }) },
    suppressNestedBorders: true,
  };
  assert.equal(next.buildFolderBoxes({ rows, indent: 0 }, settings, tokens, false)[0].startColor, "#0a85f0");
  assert.equal(next.buildFolderBoxes({ rows, indent: 0 }, settings, tokens, true)[0].startColor, "#ffb2cb");
});

test("block left edge stays at the anchor folder's indentation when its row is not rendered", () => {
  const indent = 16;
  // Notebook Navigator indents each level by `indent`; root shown at level 0.
  const indented = (paths) =>
    paths.map((p, index) => ({ path: p, top: index * 28, bottom: (index + 1) * 28, left: 10 + (p.split("/").length) * indent, right: 290 }));
  const tokens = { folderWidth: 2, groupWidth: 2, angle: 135, opacity: 0.8, folderGeometry: { insetX: 1, insetY: 1, radius: 14 }, groupGeometry: { insetX: 0, insetY: 1, radius: 10 } };
  const groups = next.normalizeBorderGroups([{ id: "dikm", name: "DIKM", folders: ["10. Data (D)", "20. Information (I)"], style: { startColor: "#005bac" } }]);
  const full = indented(["10. Data (D)", "20. Information (I)", "20. Information (I)/201", "20. Information (I)/202"]);
  const scrolled = full.slice(2); // only the indented children are rendered
  const fullBox = next.buildGroupBoxes({ rows: full, indent }, groups, tokens, false)[0];
  const scrolledBox = next.buildGroupBoxes({ rows: scrolled, indent }, groups, tokens, false)[0];
  assert.equal(fullBox.left, 26);
  assert.equal(scrolledBox.left, 26);
  // Without indentation info the old behaviour (hug rendered rows) is kept.
  assert.equal(next.buildGroupBoxes({ rows: scrolled, indent: 0 }, groups, tokens, false)[0].left, 42);
  // Folder borders get the same treatment.
  const settings = { folderBorders: { "20. Information (I)": next.normalizeBorderStyle("#123456") }, suppressNestedBorders: true };
  const withParent = next.buildFolderBoxes({ rows: full, indent }, settings, tokens, false)[0];
  assert.equal(withParent.left, 27);
  // Parent row scrolled away: the border keeps going around the rendered children, at the parent's indentation.
  const withoutParent = next.buildFolderBoxes({ rows: scrolled, indent }, settings, tokens, false);
  assert.equal(withoutParent.length, 1);
  assert.equal(withoutParent[0].left, 27);
  assert.deepEqual(next.borderedFolderPaths(scrolled, settings.folderBorders, true), ["20. Information (I)"]);
  // Nested suppression still applies to ancestors found this way.
  const nested = { "20. Information (I)": settings.folderBorders["20. Information (I)"], "20. Information (I)/201": next.normalizeBorderStyle("#654321") };
  assert.deepEqual(next.borderedFolderPaths(scrolled, nested, true), ["20. Information (I)"]);
  assert.deepEqual(next.borderedFolderPaths(scrolled, nested, false), ["20. Information (I)", "20. Information (I)/201"]);
});

test("dark colors survive normalize → compact → normalize", () => {
  const style = next.normalizeBorderStyle({ startColor: "#005BAC", darkStartColor: "#F27AA4", darkEndColor: "#FFB2CB", radius: 14 });
  const compact = next.compactBorderStyle(style, { insetX: 1, insetY: 1, radius: 14 });
  assert.deepEqual(compact, { startColor: "#005bac", endColor: null, darkStartColor: "#f27aa4", darkEndColor: "#ffb2cb" });
  // radius 14 equals the default, so it is dropped and keeps following Style Settings.
  assert.deepEqual(next.normalizeBorderStyle(compact), { ...style, radius: null });
  // A dark end color without a dark start color is ignored.
  assert.equal(next.normalizeBorderStyle({ startColor: "#000000", darkEndColor: "#ffffff" }).darkEndColor, null);
  assert.deepEqual(next.resolveThemeColors(next.normalizeBorderStyle("#123456"), true), { startColor: "#123456", endColor: null });
});

test("group normalization repairs ids, names, folders and styles", () => {
  const groups = next.normalizeBorderGroups([
    { id: "a", name: "  DIKM ", folders: ["x", "x", "", 3, "y"], style: { startColor: "#abc" } },
    { id: "a", name: "", folders: "nope", style: { startColor: "bad" } },
    null,
    "junk",
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, "DIKM");
  assert.deepEqual(groups[0].folders, ["x", "y"]);
  assert.notEqual(groups[1].id, "a");
  assert.equal(groups[1].name, "Group 2");
  assert.deepEqual(groups[1].folders, []);
  assert.equal(groups[1].style.startColor, "#7f8c8d");
  assert.deepEqual(next.normalizeBorderGroups(undefined), []);
});

test("group folder paths follow renames and deletes", () => {
  const groups = [{ id: "g", name: "G", folders: ["10. Data (D)", "10. Data (D)/101", "20. Info"], style: {} }];
  assert.deepEqual(next.renameGroupFolders(groups, "10. Data (D)", "10. Data")[0].folders, ["10. Data", "10. Data/101", "20. Info"]);
  assert.deepEqual(next.removeGroupFolders(groups, "10. Data (D)")[0].folders, ["20. Info"]);
  // Renaming onto an existing member collapses duplicates.
  assert.deepEqual(next.renameGroupFolders(groups, "20. Info", "10. Data (D)")[0].folders, ["10. Data (D)", "10. Data (D)/101"]);
});

// ---------------------------------------------------------------------------
// Plugin methods (settings mutations)
// ---------------------------------------------------------------------------

function makePlugin(initialData) {
  global.document = { body: { classList: { contains: () => false } } };
  global.getComputedStyle = () => fakeComputed({});
  global.requestAnimationFrame = () => 0;
  const Plugin = next.AchmageNnBorderAddon;
  const plugin = new Plugin({ workspace: {}, vault: {} }, { id: "achmage-nn-border-addon" });
  plugin._data = initialData;
  return plugin;
}

test("plugin group mutations keep one group per folder and persist", async () => {
  const plugin = makePlugin(JSON.parse(fs.readFileSync(path.join(FIXTURES, "data-v3.json"), "utf8")));
  plugin.settings = await next.loadSettings(plugin);

  const dikmStyle = next.normalizeBorderStyle({ startColor: "#005bac", darkStartColor: "#f27aa4", insetY: 1, radius: 10 });
  await plugin.saveGroup({ id: "dikm", name: "DIKM", folders: ["10. Data (D)", "20. Information (I)"] }, dikmStyle);
  await plugin.saveGroup({ id: "out", name: "Outputs", folders: ["50. Teaching Materials"] }, next.normalizeBorderStyle("#b6a599"));
  assert.deepEqual(plugin.settings.borderGroups.map((g) => g.id), ["dikm", "out"]);
  // Geometry equal to the group defaults is not stored.
  assert.deepEqual(plugin.settings.borderGroups[0].style, { startColor: "#005bac", endColor: null, darkStartColor: "#f27aa4", darkEndColor: null });
  assert.deepEqual(plugin.settings.recentBorderColors.slice(0, 3), ["#b6a599", "#005bac", "#f27aa4"]);

  // Moving a folder to another group removes it from the first.
  await plugin.addFolderToGroup("20. Information (I)", "out");
  assert.deepEqual(plugin.settings.borderGroups[0].folders, ["10. Data (D)"]);
  assert.deepEqual(plugin.settings.borderGroups[1].folders, ["50. Teaching Materials", "20. Information (I)"]);
  assert.equal(plugin.findGroupOfFolder("20. Information (I)").id, "out");

  // Saving a group that claims folders takes them from others too.
  await plugin.saveGroup({ id: "dikm", name: "DIKM", folders: ["10. Data (D)", "20. Information (I)"] }, dikmStyle);
  assert.deepEqual(plugin.settings.borderGroups[1].folders, ["50. Teaching Materials"]);

  await plugin.removeFolderFromGroup("10. Data (D)", "dikm");
  assert.deepEqual(plugin.settings.borderGroups[0].folders, ["20. Information (I)"]);

  await plugin.deleteGroup("out");
  assert.deepEqual(plugin.settings.borderGroups.map((g) => g.id), ["dikm"]);

  // What was written to disk reloads to the same settings.
  const reloaded = await next.loadSettings(plugin);
  assert.deepEqual(reloaded.borderGroups[0].folders, ["20. Information (I)"]);
  assert.equal(reloaded.borderGroups[0].style.darkStartColor, "#f27aa4");
  assert.equal(reloaded.version, 4);
  assert.deepEqual(Object.keys(reloaded.folderBorders), ["/", "00. Meta", "80. References", "90. Settings"]);
});

test("folder renames only write data.json when a saved path changes", async () => {
  const plugin = makePlugin(null);
  plugin.settings = await next.loadSettings(plugin);
  await plugin.saveGroup({ id: "g", name: "G", folders: ["a"] }, next.normalizeBorderStyle("#123456"));
  const writes = plugin.saved.length;
  await plugin.updateFolderPaths({
    folderBorders: next.renameFolderKeys(plugin.settings.folderBorders, "unrelated", "other"),
    borderGroups: next.renameGroupFolders(plugin.settings.borderGroups, "unrelated", "other"),
  });
  assert.equal(plugin.saved.length, writes);
  await plugin.updateFolderPaths({
    folderBorders: plugin.settings.folderBorders,
    borderGroups: next.renameGroupFolders(plugin.settings.borderGroups, "a", "b"),
  });
  assert.equal(plugin.saved.length, writes + 1);
  assert.deepEqual(plugin.settings.borderGroups[0].folders, ["b"]);
});

test("folder border with dark colors keeps them through setFolderBorder", async () => {
  const plugin = makePlugin(null);
  plugin.settings = await next.loadSettings(plugin);
  await plugin.setFolderBorder("/", next.normalizeBorderStyle({ startColor: "#0a85f0", darkStartColor: "#ffb2cb", darkEndColor: "#f27aa4", insetX: 1 }));
  assert.deepEqual(plugin.settings.folderBorders["/"], { startColor: "#0a85f0", endColor: null, darkStartColor: "#ffb2cb", darkEndColor: "#f27aa4" });
  await plugin.clearFolderBorder("/");
  assert.deepEqual(plugin.settings.folderBorders, {});
  // Prototype keys are not mistaken for saved borders.
  await plugin.clearFolderBorder("constructor");
  assert.deepEqual(next.borderedFolderPaths(treeRows(["constructor"]), {}, true), []);
});
