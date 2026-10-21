"use strict";

/*
 * Achmage Notebook Navigator Border Add-on
 *
 * Draws SVG borders on top of Notebook Navigator's folder tree without
 * modifying Notebook Navigator itself.
 *
 *   - Folder borders: one border around a folder row (and its expanded children).
 *   - Group borders:  one border around a block of folders grouped by the user.
 *     Grouped folders that sit next to each other in the tree share a single
 *     border; anything else in between starts a new block.
 *   - Folder colors:  separate light/dark text and background colors for folders,
 *     drawn over Notebook Navigator's single color with a generated stylesheet.
 *     Notebook Navigator's own data is never written.
 *
 * Every border can use separate colors in light and dark mode.
 */

const {
  ButtonComponent,
  ExtraButtonComponent,
  FuzzySuggestModal,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  SuggestModal,
  TFolder,
} = require("obsidian");

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const FOLDER_GEOMETRY = {
  fallback: { insetX: 1, insetY: 1, radius: 14 },
  insetX: ["--ach-nn-border-inset-x", "--ach-nn-border-pad-x"],
  insetY: ["--ach-nn-border-inset-y", "--ach-nn-border-pad-y"],
  radius: ["--ach-nn-border-radius", null],
};

const GROUP_GEOMETRY = {
  fallback: { insetX: 0, insetY: 1, radius: 10 },
  insetX: ["--ach-nn-group-border-inset-x", null],
  insetY: ["--ach-nn-group-border-inset-y", null],
  radius: ["--ach-nn-group-border-radius", null],
};

function clampInset(value) {
  return Math.min(12, Math.max(-12, Math.round(value)));
}

function clampRadius(value) {
  return Math.min(24, Math.max(0, Math.round(value)));
}

function parseInset(value) {
  const number = toFiniteNumber(value);
  return number === null ? null : clampInset(number);
}

function parseRadius(value) {
  const number = toFiniteNumber(value);
  return number === null ? null : clampRadius(number);
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

// Per-border overrides win; missing values follow the Style Settings defaults.
function resolveGeometry(style, defaults) {
  return {
    insetX: style?.insetX == null ? defaults.insetX : clampInset(style.insetX),
    insetY: style?.insetY == null ? defaults.insetY : clampInset(style.insetY),
    radius: style?.radius == null ? defaults.radius : clampRadius(style.radius),
  };
}

function readGeometryDefaults(computed, spec) {
  return {
    insetX: clampInset(readNumberVar(computed, spec.insetX[0], spec.insetX[1], spec.fallback.insetX)),
    insetY: clampInset(readNumberVar(computed, spec.insetY[0], spec.insetY[1], spec.fallback.insetY)),
    radius: clampRadius(readNumberVar(computed, spec.radius[0], spec.radius[1], spec.fallback.radius)),
  };
}

function readNumberVar(computed, name, fallbackName, fallback) {
  const value = parseFloat(computed.getPropertyValue(name));
  if (!Number.isNaN(value)) return value;
  if (fallbackName) {
    const fallbackValue = parseFloat(computed.getPropertyValue(fallbackName));
    if (!Number.isNaN(fallbackValue)) return fallbackValue;
  }
  return fallback;
}

function readOpacityVar(computed, name, fallback) {
  const raw = computed.getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.endsWith("%")) {
    const percent = parseFloat(raw.slice(0, -1));
    if (!Number.isNaN(percent)) return percent / 100;
  }
  const value = parseFloat(raw);
  return Number.isNaN(value) ? fallback : value;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SETTINGS_VERSION = 5;
const MAX_RECENT_COLORS = 12;
const DEFAULT_COLOR = "#7f8c8d";
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  folderBorders: {},
  borderGroups: [],
  folderColorOverrides: {},
  showFolderBorders: true,
  showGroupBorders: true,
  showFolderColors: true,
  recentBorderColors: [],
  suppressNestedBorders: true,
  debug: false,
};

async function loadSettings(plugin) {
  const raw = await plugin.loadData();
  return {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
    version: SETTINGS_VERSION,
    folderBorders: normalizeFolderBorders(raw?.folderBorders),
    borderGroups: normalizeBorderGroups(raw?.borderGroups),
    folderColorOverrides: normalizeFolderColorOverrides(raw?.folderColorOverrides),
    showFolderBorders: raw?.showFolderBorders !== false,
    showGroupBorders: raw?.showGroupBorders !== false,
    showFolderColors: raw?.showFolderColors !== false,
    suppressNestedBorders: raw?.suppressNestedBorders !== false,
    recentBorderColors: Array.isArray(raw?.recentBorderColors)
      ? raw.recentBorderColors
          .map((color) => (typeof color === "string" ? normalizeHexColor(color) : null))
          .filter((color) => color !== null)
          .slice(0, MAX_RECENT_COLORS)
      : [...DEFAULT_SETTINGS.recentBorderColors],
  };
}

async function saveSettings(plugin, settings) {
  await plugin.saveData({ ...settings, version: SETTINGS_VERSION });
}

function normalizeHexColor(value) {
  const trimmed = value.trim();
  if (!HEX_COLOR.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (lower.length === 7) return lower;
  const [hash, r, g, b] = lower.split("");
  return `${hash}${r}${r}${g}${g}${b}${b}`;
}

function optionalHexColor(value) {
  return typeof value === "string" ? normalizeHexColor(value) : null;
}

// Accepts the legacy "#rrggbb" string format as well as style objects.
function normalizeBorderStyle(raw) {
  if (typeof raw === "string") {
    const color = normalizeHexColor(raw);
    return color
      ? { startColor: color, endColor: null, darkStartColor: null, darkEndColor: null, insetX: null, insetY: null, radius: null }
      : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const startColor = optionalHexColor(raw.startColor);
  if (!startColor) return null;
  const darkStartColor = optionalHexColor(raw.darkStartColor);
  return {
    startColor,
    endColor: optionalHexColor(raw.endColor),
    darkStartColor,
    darkEndColor: darkStartColor ? optionalHexColor(raw.darkEndColor) : null,
    insetX: parseInset(raw.insetX),
    insetY: parseInset(raw.insetY),
    radius: parseRadius(raw.radius),
  };
}

// Stores only geometry that differs from the current defaults, so untouched
// values keep following Style Settings.
function compactBorderStyle(style, defaults) {
  const compact = { startColor: style.startColor, endColor: style.endColor };
  if (style.darkStartColor) {
    compact.darkStartColor = style.darkStartColor;
    compact.darkEndColor = style.darkEndColor ?? null;
  }
  if (style.insetX != null) {
    const insetX = clampInset(style.insetX);
    if (insetX !== defaults.insetX) compact.insetX = insetX;
  }
  if (style.insetY != null) {
    const insetY = clampInset(style.insetY);
    if (insetY !== defaults.insetY) compact.insetY = insetY;
  }
  if (style.radius != null) {
    const radius = clampRadius(style.radius);
    if (radius !== defaults.radius) compact.radius = radius;
  }
  return compact;
}

function normalizeFolderBorders(raw) {
  if (!raw || typeof raw !== "object") return {};
  const borders = {};
  for (const [path, value] of Object.entries(raw)) {
    const style = normalizeBorderStyle(value);
    if (style) borders[path] = style;
  }
  return borders;
}

function normalizeBorderGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const usedIds = new Set();
  const groups = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    let id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : createGroupId();
    while (usedIds.has(id)) id = createGroupId();
    usedIds.add(id);
    groups.push({
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : `Group ${groups.length + 1}`,
      folders: Array.isArray(entry.folders) ? uniquePaths(entry.folders.filter((path) => typeof path === "string" && path)) : [],
      style: normalizeBorderStyle(entry.style) ?? normalizeBorderStyle(DEFAULT_COLOR),
    });
  }
  return groups;
}

function createGroupId() {
  return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function pushRecentColors(settings, colors) {
  const normalized = colors.map((color) => normalizeHexColor(color)).filter((color) => color !== null);
  if (normalized.length === 0) return settings;
  const unique = normalized.filter((color, index) => normalized.indexOf(color) === index);
  const seen = new Set(unique);
  return {
    ...settings,
    recentBorderColors: [...unique, ...settings.recentBorderColors.filter((color) => !seen.has(color))].slice(0, MAX_RECENT_COLORS),
  };
}

function styleColors(style) {
  return [style.startColor, style.endColor, style.darkStartColor, style.darkEndColor].filter(Boolean);
}

function getOwn(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

// ---------------------------------------------------------------------------
// Folder paths
// ---------------------------------------------------------------------------

function isSameOrDescendant(ancestor, path) {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

function pathDepth(path) {
  return path ? path.split("/").length : 0;
}

function renamePath(path, oldPath, newPath) {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`)) return `${newPath}${path.slice(oldPath.length)}`;
  return path;
}

function selfAndAncestorPaths(path) {
  const parts = path.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/")).filter(Boolean);
}

function uniquePaths(paths) {
  return paths.filter((path, index) => paths.indexOf(path) === index);
}

function renameFolderKeys(map, oldPath, newPath) {
  const renamed = {};
  for (const [path, value] of Object.entries(map)) renamed[renamePath(path, oldPath, newPath)] = value;
  return renamed;
}

function removeFolderKeys(map, removedPath) {
  const kept = {};
  for (const [path, value] of Object.entries(map)) {
    if (!isSameOrDescendant(removedPath, path)) kept[path] = value;
  }
  return kept;
}

function renameGroupFolders(groups, oldPath, newPath) {
  return groups.map((group) => ({
    ...group,
    folders: uniquePaths(group.folders.map((path) => renamePath(path, oldPath, newPath))),
  }));
}

function removeGroupFolders(groups, removedPath) {
  return groups.map((group) => ({
    ...group,
    folders: group.folders.filter((path) => !isSameOrDescendant(removedPath, path)),
  }));
}

function displayFolderPath(path) {
  return path === "/" ? "/ (vault root)" : path;
}

// ---------------------------------------------------------------------------
// Theme colors
// ---------------------------------------------------------------------------

function isDarkTheme() {
  return document.body.classList.contains("theme-dark");
}

function resolveThemeColors(style, dark) {
  if (dark && style.darkStartColor) {
    return { startColor: style.darkStartColor, endColor: style.darkEndColor ?? null };
  }
  return { startColor: style.startColor, endColor: style.endColor ?? null };
}

// ---------------------------------------------------------------------------
// Folder colors (light/dark)
// ---------------------------------------------------------------------------

// Notebook Navigator keeps one text color and one background per folder.
// An override gives each theme its own value:
//   { light: { color, background }, dark: { color, background } }
// A missing value keeps Notebook Navigator's color in that theme; "none"
// removes it there.
const THEMES = ["light", "dark"];
const FOLDER_COLOR_KEYS = ["color", "background"];
const NO_COLOR = "none";
const CSS_HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const FOLDER_ROW = ".nn-navitem.nn-folder";

// Hex colors with optional alpha (#rgb, #rgba, #rrggbb, #rrggbbaa) or "none".
function normalizeFolderColorValue(value) {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (lower === NO_COLOR) return NO_COLOR;
  if (!CSS_HEX_COLOR.test(lower)) return null;
  if (lower.length > 5) return lower;
  return `#${lower
    .slice(1)
    .split("")
    .map((digit) => digit + digit)
    .join("")}`;
}

function normalizeFolderColorOverride(raw) {
  if (!raw || typeof raw !== "object") return null;
  const override = {};
  for (const theme of THEMES) {
    const slots = {};
    for (const key of FOLDER_COLOR_KEYS) {
      const value = normalizeFolderColorValue(raw[theme]?.[key]);
      if (value) slots[key] = value;
    }
    if (Object.keys(slots).length > 0) override[theme] = slots;
  }
  return Object.keys(override).length > 0 ? override : null;
}

function normalizeFolderColorOverrides(raw) {
  if (!raw || typeof raw !== "object") return {};
  const overrides = {};
  for (const [path, value] of Object.entries(raw)) {
    const override = normalizeFolderColorOverride(value);
    if (override) overrides[path] = override;
  }
  return overrides;
}

function overrideColors(override) {
  return THEMES.flatMap((theme) => FOLDER_COLOR_KEYS.map((key) => override[theme]?.[key])).filter(
    (value) => value && value !== NO_COLOR,
  );
}

// Folders that show an override in one theme, grouped by color value.
// Walks the tree the way Notebook Navigator resolves colors: a folder without a
// color of its own takes its parent's when inheritance is on, so subfolders of
// an overridden folder follow the override until one has its own color.
//   tree.children(path)     - child folder paths ("/" is the vault root)
//   tree.hasOwn(path, key)  - Notebook Navigator has its own color/background there
function collectFolderColorRules(tree, overrides, theme, key, inherit) {
  const valueOf = (path) => getOwn(overrides, path)?.[theme]?.[key] ?? null;
  const overridePaths = Object.keys(overrides).filter((path) => valueOf(path));
  const rules = new Map();
  if (overridePaths.length === 0) return rules;
  const hasOverrideBelow = (path) => path === "/" || overridePaths.some((other) => isSameOrDescendant(path, other));
  const visit = (path, inherited) => {
    const value = valueOf(path) ?? (inherit && !tree.hasOwn(path, key) ? inherited : null);
    if (value) {
      if (!rules.has(value)) rules.set(value, []);
      rules.get(value).push(path);
    }
    if (!(value && inherit) && !hasOverrideBelow(path)) return;
    for (const child of tree.children(path)) visit(child, value);
  };
  visit("/", null);
  return rules;
}

function cssString(value) {
  const escaped = value.replace(/[\\"]/g, "\\$&").replace(/[\n\r\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
  return `"${escaped}"`;
}

function folderRowSelectors(theme, paths, suffix) {
  return paths.map((path) => `body.theme-${theme} ${FOLDER_ROW}[data-path=${cssString(path)}]${suffix}`).join(",\n");
}

// Notebook Navigator writes folder colors as inline styles: `color` on the
// icon and name, `--nn-navitem-custom-bg-color` on the row. !important rules
// win over inline styles, and theme-scoped selectors switch with the theme.
function buildFolderColorCss(tree, overrides, { inherit = true, colorIconOnly = false } = {}) {
  const blocks = [];
  const rule = (selectors, declarations) => blocks.push(`${selectors} {\n  ${declarations.join(";\n  ")};\n}`);
  for (const theme of THEMES) {
    for (const [value, paths] of collectFolderColorRules(tree, overrides, theme, "color", inherit)) {
      const rows = (suffix) => folderRowSelectors(theme, paths, suffix);
      if (value === NO_COLOR) {
        rule(rows(":not(.nn-selected) .nn-navitem-icon"), ["color: var(--nn-theme-navitem-icon-color) !important"]);
        rule(rows(".nn-selected .nn-navitem-icon"), ["color: var(--nn-selected-navitem-icon-color) !important"]);
        if (colorIconOnly) continue;
        const weight = "font-weight: var(--nn-theme-navitem-name-font-weight)";
        rule(rows(":not(.nn-selected) .nn-navitem-name"), ["color: var(--nn-theme-navitem-name-color) !important", weight]);
        rule(rows(".nn-selected .nn-navitem-name"), ["color: var(--nn-selected-navitem-name-color) !important", weight]);
      } else {
        rule(rows(" .nn-navitem-icon"), [`color: ${value} !important`]);
        if (colorIconOnly) continue;
        rule(rows(" .nn-navitem-name"), [`color: ${value} !important`, "font-weight: var(--nn-theme-navitem-custom-color-name-font-weight)"]);
      }
    }
    const filled = [];
    for (const [value, paths] of collectFolderColorRules(tree, overrides, theme, "background", inherit)) {
      rule(folderRowSelectors(theme, paths, ""), [`--nn-navitem-custom-bg-color: ${value === NO_COLOR ? "transparent" : value} !important`]);
      if (value !== NO_COLOR) filled.push(...paths);
    }
    if (filled.length === 0) continue;
    // Rows Notebook Navigator renders without a background have no ::before
    // layer, so draw one the way it does.
    const bare = (suffix) => folderRowSelectors(theme, filled, `:not(.nn-has-custom-background)${suffix}`);
    rule(bare(""), ["position: relative"]);
    rule(bare("::before"), [
      'content: ""',
      "position: absolute",
      "top: 0",
      "inset-inline-start: 0",
      "inset-inline-end: 0",
      "bottom: var(--nn-navitem-background-bottom-overdraw, 0px)",
      "background-color: var(--nn-navitem-custom-bg-color)",
      "border-radius: min(14px, var(--nn-theme-navitem-border-radius, 4px))",
      "box-shadow: inset 0 0 0 var(--nn-theme-navitem-border-width, 0px) var(--nn-theme-navitem-custom-border-color, transparent)",
      "z-index: 0",
      "pointer-events: none",
    ]);
    rule(bare(" > .nn-navitem-content"), ["position: relative", "z-index: 2"]);
  }
  return blocks.join("\n");
}

function folderAtPath(app, path) {
  const file = path === "/" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(path);
  return file instanceof TFolder ? file : null;
}

// The vault's folder tree plus Notebook Navigator's own colors (read through
// its public API, which also covers folder-note frontmatter colors).
function notebookNavigatorFolderTree(app, api) {
  const own = new Map();
  const ownColors = (path) => {
    if (!own.has(path)) {
      const folder = folderAtPath(app, path);
      own.set(path, folder ? api.metadata?.getFolderMeta?.(folder) ?? null : null);
    }
    return own.get(path);
  };
  return {
    children(path) {
      const folder = folderAtPath(app, path);
      return folder ? folder.children.filter((child) => child instanceof TFolder).map((child) => child.path) : [];
    },
    hasOwn(path, key) {
      const meta = ownColors(path);
      return Boolean(key === "background" ? meta?.backgroundColor : meta?.color);
    },
  };
}

// Notebook Navigator settings that change how its folder colors are drawn.
function readNotebookNavigatorColorFlags(app) {
  const settings = app.plugins?.plugins?.["notebook-navigator"]?.settings;
  return { inherit: settings?.inheritFolderColors !== false, colorIconOnly: settings?.colorIconOnly === true };
}

class FolderColorStyles {
  constructor() {
    this.styleEl = null;
    this.css = "";
  }

  apply(css) {
    if (css === this.css) return;
    if (!css) {
      this.remove();
      return;
    }
    this.css = css;
    if (!this.styleEl) {
      this.styleEl = document.createElement("style");
      this.styleEl.id = "ach-nn-folder-colors";
      document.head.appendChild(this.styleEl);
    }
    this.styleEl.textContent = css;
  }

  remove() {
    this.styleEl?.remove();
    this.styleEl = null;
    this.css = "";
  }
}

// ---------------------------------------------------------------------------
// SVG drawing
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";
const SQUIRCLE = { outerRadiusMultiplier: 1.18, handleScale: 1.06 };
const QUARTER_TURN = Math.PI / 2;
const EIGHTH_TURN = Math.PI / 4;

function gradientVector(width, height, angleDeg, colors) {
  const angle = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const cx = width / 2;
  const cy = height / 2;
  const reach = Math.max(
    Math.abs(dx) > 1e-6 ? width / 2 / Math.abs(dx) : 0,
    Math.abs(dy) > 1e-6 ? height / 2 / Math.abs(dy) : 0,
  );
  return {
    x1: round3(cx - dx * reach),
    y1: round3(cy - dy * reach),
    x2: round3(cx + dx * reach),
    y2: round3(cy + dy * reach),
    startColor: colors.startColor,
    endColor: colors.endColor ?? colors.startColor,
  };
}

function round3(value) {
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? 0 : rounded;
}

// Rounded rectangle with slightly squircle-like corners; the stroke stays
// inside the box.
function borderPath(width, height, radius, strokeWidth) {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const half = Math.max(0, strokeWidth / 2);
  if (radius <= 0 || Math.min(w, h) <= strokeWidth + 2) return rectPath(w, h, half);
  const outer = Math.min(Math.max(0, radius * SQUIRCLE.outerRadiusMultiplier), w / 2, h / 2);
  const arcRadius = outer - half;
  if (arcRadius <= 0) return rectPath(w, h, half);
  return [
    `M ${fmt(outer)} ${fmt(half)}`,
    `L ${fmt(w - outer)} ${fmt(half)}`,
    ...cornerArc(w - outer, outer, arcRadius, -QUARTER_TURN, 0),
    `L ${fmt(w - half)} ${fmt(h - outer)}`,
    ...cornerArc(w - outer, h - outer, arcRadius, 0, QUARTER_TURN),
    `L ${fmt(outer)} ${fmt(h - half)}`,
    ...cornerArc(outer, h - outer, arcRadius, QUARTER_TURN, Math.PI),
    `L ${fmt(half)} ${fmt(outer)}`,
    ...cornerArc(outer, outer, arcRadius, Math.PI, Math.PI + QUARTER_TURN),
    "Z",
  ].join(" ");
}

function cornerArc(cx, cy, radius, startAngle, endAngle) {
  const middle = startAngle + EIGHTH_TURN;
  return [arcSegment(cx, cy, radius, startAngle, middle), arcSegment(cx, cy, radius, middle, endAngle)];
}

function arcSegment(cx, cy, radius, startAngle, endAngle) {
  const handle = (4 / 3) * Math.tan((endAngle - startAngle) / 4) * radius * SQUIRCLE.handleScale;
  const x0 = cx + radius * Math.cos(startAngle);
  const y0 = cy + radius * Math.sin(startAngle);
  const x1 = cx + radius * Math.cos(endAngle);
  const y1 = cy + radius * Math.sin(endAngle);
  return [
    "C",
    fmt(x0 - Math.sin(startAngle) * handle),
    fmt(y0 + Math.cos(startAngle) * handle),
    fmt(x1 + Math.sin(endAngle) * handle),
    fmt(y1 - Math.cos(endAngle) * handle),
    fmt(x1),
    fmt(y1),
  ].join(" ");
}

function rectPath(width, height, half) {
  return [
    `M ${fmt(half)} ${fmt(half)}`,
    `L ${fmt(width - half)} ${fmt(half)}`,
    `L ${fmt(width - half)} ${fmt(height - half)}`,
    `L ${fmt(half)} ${fmt(height - half)}`,
    "Z",
  ].join(" ");
}

function fmt(value) {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

// ---------------------------------------------------------------------------
// Notebook Navigator DOM
// ---------------------------------------------------------------------------

const SELECTORS = {
  pane: ".nn-navigation-pane",
  scroller: ".nn-navigation-pane-scroller",
  overlayHostCandidates: [".nn-virtual-container"],
  navRow: ".nn-navitem",
  folderRowCandidates: [
    '.nn-navitem[data-clickable="folder"][data-path]',
    '.nn-navitem[data-drag-type="folder"][data-path]',
    ".nn-navitem.nn-folder[data-path]",
  ],
  rowContent: ".nn-navitem-content",
  layerClass: "ach-nn-border-layer",
  boxClass: "ach-nn-folder-border-box",
  groupBoxClass: "ach-nn-group-border-box",
};

function findNavigationPanes() {
  return Array.from(document.querySelectorAll(SELECTORS.pane));
}

function findScroller(pane) {
  return pane.querySelector(SELECTORS.scroller);
}

function findOverlayHost(scroller) {
  for (const selector of SELECTORS.overlayHostCandidates) {
    const host = scroller.querySelector(`:scope > ${selector}`);
    if (host) return host;
  }
  return scroller;
}

function findFolderRows(root) {
  const seen = new Set();
  const rows = [];
  for (const selector of SELECTORS.folderRowCandidates) {
    for (const row of Array.from(root.querySelectorAll(selector))) {
      if (seen.has(row)) continue;
      seen.add(row);
      rows.push(row);
    }
  }
  return rows;
}

// Every rendered navigation row in visual order. Non-folder rows (tags,
// shortcuts, section headers) have path null and act as block separators.
// Also returns Notebook Navigator's per-level indentation in px.
function measureNavRows(scroller, host) {
  const hostRect = host.getBoundingClientRect();
  const hostIsScroller = host === scroller;
  const scrollTop = hostIsScroller ? scroller.scrollTop : 0;
  const scrollLeft = hostIsScroller ? scroller.scrollLeft : 0;
  const folderRows = new Set(findFolderRows(scroller));
  const rowEls = new Set([...Array.from(scroller.querySelectorAll(SELECTORS.navRow)), ...folderRows]);
  const rows = [];
  let indent = null;
  for (const rowEl of rowEls) {
    if (indent === null && folderRows.has(rowEl)) {
      indent = parseFloat(getComputedStyle(rowEl).getPropertyValue("--nn-setting-nav-indent"));
    }
    const contentEl = rowEl.querySelector(SELECTORS.rowContent) ?? rowEl;
    const rect = contentEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    rows.push({
      path: folderRows.has(rowEl) ? rowEl.getAttribute("data-path") || null : null,
      top: rect.top - hostRect.top + scrollTop,
      left: rect.left - hostRect.left + scrollLeft,
      right: rect.right - hostRect.left + scrollLeft,
      bottom: rect.bottom - hostRect.top + scrollTop,
    });
  }
  return { rows: rows.sort((a, b) => a.top - b.top), indent: Number.isFinite(indent) ? indent : 0 };
}

// Splits rows into maximal runs of consecutive rows whose folder path matches.
function collectRuns(rows, matchesPath) {
  const runs = [];
  let current = null;
  for (const row of rows) {
    if (row.path !== null && matchesPath(row.path)) {
      if (!current) current = [];
      current.push(row);
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs;
}

// Subfolder rows are indented. Shifting each row back to the level of the
// folder its block starts from keeps the left edge in place even when that
// folder's own row has scrolled out of Notebook Navigator's virtual list.
function alignRowsToAnchor(rows, anchorOf, indent) {
  if (!indent) return rows;
  return rows.map((row) => ({ ...row, left: row.left - (pathDepth(row.path) - pathDepth(anchorOf(row.path))) * indent }));
}

function boxFromRows(rows, geometry, strokeWidth) {
  const top = Math.min(...rows.map((row) => row.top)) + geometry.insetY;
  const left = Math.min(...rows.map((row) => row.left)) + geometry.insetX;
  const right = Math.max(...rows.map((row) => row.right)) - geometry.insetX;
  const bottom = Math.max(...rows.map((row) => row.bottom)) - geometry.insetY;
  const minSize = strokeWidth * 2 + 2;
  const width = right - left;
  const height = bottom - top;
  const boxWidth = Math.max(width, minSize);
  const boxHeight = Math.max(height, minSize);
  return {
    top: height >= minSize ? top : (top + bottom) / 2 - boxHeight / 2,
    left: width >= minSize ? left : (left + right) / 2 - boxWidth / 2,
    width: boxWidth,
    height: boxHeight,
  };
}

// Bordered folders with at least one rendered row (their own or a
// descendant's), shallowest first. With suppressNested, folders inside an
// already bordered folder are skipped.
function borderedFolderPaths(rows, folderBorders, suppressNested) {
  const candidates = [];
  for (const row of rows) {
    if (!row.path) continue;
    for (const path of selfAndAncestorPaths(row.path)) {
      if (getOwn(folderBorders, path) && !candidates.includes(path)) candidates.push(path);
    }
  }
  candidates.sort((a, b) => pathDepth(a) - pathDepth(b));
  if (!suppressNested) return candidates;
  const paths = [];
  for (const path of candidates) {
    if (!paths.some((parent) => isSameOrDescendant(parent, path))) paths.push(path);
  }
  return paths;
}

function buildFolderBoxes({ rows, indent }, settings, tokens, dark) {
  const boxes = [];
  for (const path of borderedFolderPaths(rows, settings.folderBorders, settings.suppressNestedBorders)) {
    const style = settings.folderBorders[path];
    const geometry = resolveGeometry(style, tokens.folderGeometry);
    const colors = resolveThemeColors(style, dark);
    collectRuns(rows, (rowPath) => isSameOrDescendant(path, rowPath)).forEach((run, index) => {
      boxes.push({
        key: `folder:${path}:${index}`,
        kind: "folder",
        ...boxFromRows(alignRowsToAnchor(run, () => path, indent), geometry, tokens.folderWidth),
        radius: geometry.radius,
        strokeWidth: tokens.folderWidth,
        ...colors,
      });
    });
  }
  return boxes;
}

function buildGroupBoxes({ rows, indent }, groups, tokens, dark) {
  const boxes = [];
  for (const group of groups) {
    if (group.folders.length === 0) continue;
    const geometry = resolveGeometry(group.style, tokens.groupGeometry);
    const colors = resolveThemeColors(group.style, dark);
    const inGroup = (rowPath) => group.folders.some((folder) => isSameOrDescendant(folder, rowPath));
    // The outermost group folder containing a row decides its block's indentation.
    const anchorOf = (rowPath) =>
      group.folders.filter((folder) => isSameOrDescendant(folder, rowPath)).sort((a, b) => pathDepth(a) - pathDepth(b))[0];
    collectRuns(rows, inGroup).forEach((run, index) => {
      boxes.push({
        key: `group:${group.id}:${index}`,
        kind: "group",
        ...boxFromRows(alignRowsToAnchor(run, anchorOf, indent), geometry, tokens.groupWidth),
        radius: geometry.radius,
        strokeWidth: tokens.groupWidth,
        ...colors,
      });
    });
  }
  return boxes;
}

function readRenderTokens(computed) {
  return {
    folderWidth: readNumberVar(computed, "--ach-nn-border-width", null, 2),
    groupWidth: readNumberVar(computed, "--ach-nn-group-border-width", null, 2),
    angle: readNumberVar(computed, "--ach-nn-border-gradient-angle", null, 135),
    opacity: readOpacityVar(computed, "--ach-nn-border-opacity", 0.8),
    folderGeometry: readGeometryDefaults(computed, FOLDER_GEOMETRY),
    groupGeometry: readGeometryDefaults(computed, GROUP_GEOMETRY),
  };
}

function renderSignature({ boxes, scrollTop, hostWidth, hostHeight, tokens }) {
  const boxPart = boxes
    .map((box) =>
      [box.key, box.startColor, box.endColor ?? "", box.top, box.left, box.width, box.height, box.radius, box.strokeWidth].join(":"),
    )
    .join("|");
  return [scrollTop, hostWidth, hostHeight, tokens.angle, tokens.opacity, boxPart].join("::");
}

class FrameScheduler {
  constructor() {
    this.pending = false;
  }

  request(callback) {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      callback();
    });
  }
}

class BorderOverlay {
  // afterRerender runs after every redraw pass, i.e. whenever the tree changed.
  constructor(getSettings, afterRerender) {
    this.getSettings = getSettings;
    this.afterRerender = afterRerender;
    this.panes = new Map();
    this.scheduler = new FrameScheduler();
    this.warnOnceKeys = new Set();
    this.svgIdSequence = 0;
  }

  stop() {
    for (const binding of this.panes.values()) {
      binding.disconnect();
      binding.layer?.remove();
    }
    this.panes.clear();
  }

  requestRerenderAll() {
    this.scheduler.request(() => this.rerenderAll());
  }

  rerenderAll() {
    this.cleanupDetachedPanes();
    for (const binding of this.panes.values()) this.renderBinding(binding);
    this.afterRerender?.();
  }

  scanAndAttach() {
    const panes = findNavigationPanes();
    const current = new Set(panes);
    for (const pane of panes) {
      if (this.panes.has(pane)) continue;
      const scroller = findScroller(pane);
      if (!scroller) {
        this.debugWarnOnce("missing-scroller", "Achmage NN Border Add-on: navigation scroller not found.");
        continue;
      }
      const rerender = () => this.requestRerenderAll();
      scroller.addEventListener("scroll", rerender, { passive: true });
      const resizeObserver = new ResizeObserver(rerender);
      resizeObserver.observe(scroller);
      const mutationObserver = new MutationObserver(rerender);
      mutationObserver.observe(scroller, { childList: true, subtree: true });
      this.panes.set(pane, {
        pane,
        scroller,
        layer: null,
        host: null,
        boxes: new Map(),
        lastSignature: null,
        disconnect: () => {
          scroller.removeEventListener("scroll", rerender);
          resizeObserver.disconnect();
          mutationObserver.disconnect();
        },
      });
    }
    for (const [pane, binding] of this.panes.entries()) {
      if (current.has(pane)) continue;
      this.clearRenderedBoxes(binding);
      binding.disconnect();
      binding.layer?.remove();
      this.panes.delete(pane);
    }
    this.requestRerenderAll();
  }

  cleanupDetachedPanes() {
    for (const [pane, binding] of this.panes.entries()) {
      if (document.contains(pane)) continue;
      this.clearRenderedBoxes(binding);
      binding.disconnect();
      binding.layer?.remove();
      this.panes.delete(pane);
    }
  }

  ensureLayer(binding) {
    const host = findOverlayHost(binding.scroller);
    if (!host) {
      this.debugWarnOnce("missing-host", "Achmage NN Border Add-on: overlay host not found.");
      return null;
    }
    if (binding.host !== host) {
      this.clearRenderedBoxes(binding);
      binding.layer?.remove();
      binding.layer = null;
      binding.host = host;
    }
    if (!binding.layer) {
      const layer = document.createElement("div");
      layer.className = SELECTORS.layerClass;
      binding.layer = layer;
    }
    if (binding.layer.parentElement !== host) {
      host.appendChild(binding.layer);
      binding.lastSignature = null;
    }
    const style = binding.layer.style;
    if (host === binding.scroller) {
      style.top = "0";
      style.left = "0";
      style.right = "auto";
      style.bottom = "auto";
      style.width = `${Math.max(binding.scroller.clientWidth, binding.scroller.scrollWidth)}px`;
      style.height = `${binding.scroller.scrollHeight}px`;
    } else {
      style.top = "";
      style.left = "";
      style.right = "";
      style.bottom = "";
      style.width = "";
      style.height = "";
    }
    return { host, layer: binding.layer };
  }

  renderBinding(binding) {
    const settings = this.getSettings();
    const target = this.ensureLayer(binding);
    if (!target) return;
    const { host, layer } = target;

    const wantFolders = settings.showFolderBorders && Object.keys(settings.folderBorders).length > 0;
    const wantGroups = settings.showGroupBorders && settings.borderGroups.some((group) => group.folders.length > 0);
    if (!wantFolders && !wantGroups) {
      this.clearRenderedBoxes(binding);
      return;
    }

    const layout = measureNavRows(binding.scroller, host);
    if (!layout.rows.some((row) => row.path !== null)) {
      this.clearRenderedBoxes(binding);
      return;
    }

    const tokens = readRenderTokens(getComputedStyle(document.body));
    const dark = isDarkTheme();
    // Group boxes come first so folder boxes are created above them.
    const boxes = [
      ...(wantGroups ? buildGroupBoxes(layout, settings.borderGroups, tokens, dark) : []),
      ...(wantFolders ? buildFolderBoxes(layout, settings, tokens, dark) : []),
    ];
    if (boxes.length === 0) {
      this.clearRenderedBoxes(binding);
      return;
    }

    const signature = renderSignature({
      boxes,
      scrollTop: binding.scroller.scrollTop,
      hostWidth: host.clientWidth,
      hostHeight: host.clientHeight,
      tokens,
    });
    if (binding.lastSignature === signature) return;
    binding.lastSignature = signature;

    const activeKeys = new Set();
    for (const box of boxes) {
      activeKeys.add(box.key);
      let dom = binding.boxes.get(box.key);
      if (!dom) {
        dom = this.createBorderBoxDom(box.kind);
        binding.boxes.set(box.key, dom);
        layer.appendChild(dom.wrapper);
      }
      dom.wrapper.style.top = `${box.top}px`;
      dom.wrapper.style.left = `${box.left}px`;
      dom.wrapper.style.width = `${box.width}px`;
      dom.wrapper.style.height = `${box.height}px`;
      dom.svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      dom.svg.setAttribute("width", `${box.width}`);
      dom.svg.setAttribute("height", `${box.height}`);

      const gradient = gradientVector(box.width, box.height, tokens.angle, box);
      dom.gradient.setAttribute("x1", `${gradient.x1}`);
      dom.gradient.setAttribute("y1", `${gradient.y1}`);
      dom.gradient.setAttribute("x2", `${gradient.x2}`);
      dom.gradient.setAttribute("y2", `${gradient.y2}`);
      dom.startStop.setAttribute("stop-color", gradient.startColor);
      dom.endStop.setAttribute("stop-color", gradient.endColor);

      dom.path.setAttribute("d", borderPath(box.width, box.height, box.radius, box.strokeWidth));
      dom.path.setAttribute("stroke-width", `${box.strokeWidth}`);
      dom.path.setAttribute("stroke-opacity", `${tokens.opacity}`);
    }
    for (const [key, dom] of binding.boxes.entries()) {
      if (activeKeys.has(key)) continue;
      dom.wrapper.remove();
      binding.boxes.delete(key);
    }
  }

  clearRenderedBoxes(binding) {
    for (const dom of binding.boxes.values()) dom.wrapper.remove();
    binding.boxes.clear();
    binding.lastSignature = null;
  }

  createBorderBoxDom(kind) {
    const wrapper = document.createElement("div");
    wrapper.className = kind === "group" ? `${SELECTORS.boxClass} ${SELECTORS.groupBoxClass}` : SELECTORS.boxClass;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ach-nn-folder-border-svg");
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("preserveAspectRatio", "none");

    const defs = document.createElementNS(SVG_NS, "defs");
    const gradient = document.createElementNS(SVG_NS, "linearGradient");
    const startStop = document.createElementNS(SVG_NS, "stop");
    const endStop = document.createElementNS(SVG_NS, "stop");
    const gradientId = `ach-nn-border-gradient-${this.svgIdSequence++}`;
    gradient.id = gradientId;
    gradient.setAttribute("gradientUnits", "userSpaceOnUse");
    startStop.setAttribute("offset", "0%");
    endStop.setAttribute("offset", "100%");
    gradient.appendChild(startStop);
    gradient.appendChild(endStop);
    defs.appendChild(gradient);

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "ach-nn-folder-border-path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", `url(#${gradientId})`);
    path.setAttribute("vector-effect", "non-scaling-stroke");

    svg.appendChild(defs);
    svg.appendChild(path);
    wrapper.appendChild(svg);
    return { wrapper, svg, gradient, startStop, endStop, path, gradientId };
  }

  debugWarnOnce(key, message) {
    if (!this.getSettings().debug || this.warnOnceKeys.has(key)) return;
    this.warnOnceKeys.add(key);
    console.warn(message);
  }
}

// ---------------------------------------------------------------------------
// UI: modals
// ---------------------------------------------------------------------------

function createStylePreview(style) {
  const preview = document.createElement("span");
  preview.className = "ach-nn-style-preview";
  for (const dark of [false, true]) {
    const colors = resolveThemeColors(style, dark);
    const chip = document.createElement("span");
    chip.className = `ach-nn-style-chip ${dark ? "is-dark" : "is-light"}`;
    chip.style.setProperty("--ach-nn-chip-start", colors.startColor);
    chip.style.setProperty("--ach-nn-chip-end", colors.endColor ?? colors.startColor);
    chip.setAttribute("aria-label", dark ? "Dark mode" : "Light mode");
    preview.appendChild(chip);
  }
  return preview;
}

// One "A" chip per theme: the folder's text color on its background.
// nnColors are Notebook Navigator's own colors, shown where nothing overrides them.
function createFolderColorPreview(override, nnColors) {
  const preview = document.createElement("span");
  preview.className = "ach-nn-style-preview";
  for (const theme of THEMES) {
    const valueOf = (key) => {
      const value = override?.[theme]?.[key] ?? nnColors?.[key] ?? null;
      return value === NO_COLOR ? null : value;
    };
    const chip = document.createElement("span");
    chip.className = `ach-nn-color-chip is-${theme}`;
    chip.textContent = "A";
    const color = valueOf("color");
    const background = valueOf("background");
    if (color) chip.style.setProperty("--ach-nn-chip-text", color);
    if (background) chip.style.setProperty("--ach-nn-chip-fill", background);
    chip.setAttribute("aria-label", theme === "dark" ? "Dark mode" : "Light mode");
    preview.appendChild(chip);
  }
  return preview;
}

function renderRecentSwatches(containerEl, colors, label, onPick) {
  if (colors.length === 0) return null;
  const swatches = containerEl.createDiv({ cls: "ach-nn-recent-swatches" });
  for (const color of colors) {
    const swatch = swatches.createEl("button", { cls: "ach-nn-swatch", attr: { type: "button", "aria-label": `${label}: ${color}` } });
    swatch.style.backgroundColor = color;
    swatch.addEventListener("click", () => onPick(color));
  }
  return swatches;
}

class BorderStyleModal extends Modal {
  /**
   * opts: {
   *   title, currentStyle, geometryDefaults, recentColors, tip,
   *   name?            - show a name field with this initial value (groups)
   *   onApply(style, name),
   *   onClear?         - show a Clear button
   * }
   */
  constructor(app, opts) {
    super(app);
    this.opts = opts;
    const style = opts.currentStyle;
    this.nameValue = opts.name ?? "";
    this.startValue = style?.startColor ?? DEFAULT_COLOR;
    this.endValue = style?.endColor ?? "";
    this.darkEnabled = !!style?.darkStartColor;
    this.darkStartValue = style?.darkStartColor ?? this.startValue;
    this.darkEndValue = style?.darkEndColor ?? "";
    const geometry = resolveGeometry(style, opts.geometryDefaults);
    this.insetXValue = geometry.insetX;
    this.insetYValue = geometry.insetY;
    this.radiusValue = geometry.radius;
  }

  onOpen() {
    this.setTitle(this.opts.title);
    const { contentEl } = this;
    contentEl.replaceChildren();

    if (this.opts.name !== undefined) {
      new Setting(contentEl).setName("Group name").addText((text) => {
        text.setPlaceholder("DIKM").setValue(this.nameValue).onChange((value) => {
          this.nameValue = value;
        });
      });
    }

    this.renderColorPair(contentEl, {
      startName: "Start color",
      startDescription: "Required. Hex color like #aabbcc.",
      endName: "End color",
      endDescription: "Optional. Leave empty for a solid border.",
      get: () => ({ start: this.startValue, end: this.endValue }),
      set: (start, end) => {
        this.startValue = start;
        this.endValue = end;
      },
    });

    new Setting(contentEl)
      .setName("Separate dark mode colors")
      .setDesc("Use different colors when Obsidian is in dark mode. The colors above then apply to light mode only.")
      .addToggle((toggle) => {
        toggle.setValue(this.darkEnabled).onChange((value) => {
          this.darkEnabled = value;
          darkSection.toggle(value);
        });
      });
    const darkSection = contentEl.createDiv({ cls: "ach-nn-dark-section" });
    this.renderColorPair(darkSection, {
      startName: "Dark start color",
      startDescription: "Hex color used in dark mode.",
      endName: "Dark end color",
      endDescription: "Optional. Leave empty for a solid border in dark mode.",
      get: () => ({ start: this.darkStartValue, end: this.darkEndValue }),
      set: (start, end) => {
        this.darkStartValue = start;
        this.darkEndValue = end;
      },
    });
    darkSection.toggle(this.darkEnabled);

    const insetX = this.renderSliderField({
      name: "Horizontal position",
      description: "Negative moves outward. Positive moves inward.",
      min: -12,
      max: 12,
      step: 1,
      initialValue: this.insetXValue,
      formatValue: (value) => `${value}px`,
      onChange: (value) => {
        this.insetXValue = value;
      },
    });
    const insetY = this.renderSliderField({
      name: "Vertical position",
      description: "Negative moves outward. Positive moves inward.",
      min: -12,
      max: 12,
      step: 1,
      initialValue: this.insetYValue,
      formatValue: (value) => `${value}px`,
      onChange: (value) => {
        this.insetYValue = value;
      },
    });
    const radius = this.renderSliderField({
      name: "Corner radius",
      description: "Fine-tune the border corner rounding.",
      min: 0,
      max: 24,
      step: 1,
      initialValue: this.radiusValue,
      formatValue: (value) => `${value}px`,
      onChange: (value) => {
        this.radiusValue = value;
      },
    });

    const geometryActions = contentEl.createDiv({ cls: "ach-nn-field-actions" });
    new ButtonComponent(geometryActions)
      .setButtonText("Use global defaults")
      .onClick(() => {
        const defaults = this.opts.geometryDefaults;
        this.insetXValue = defaults.insetX;
        this.insetYValue = defaults.insetY;
        this.radiusValue = defaults.radius;
        insetX.slider.setValue(defaults.insetX);
        insetX.valueEl.setText(`${defaults.insetX}px`);
        insetY.slider.setValue(defaults.insetY);
        insetY.valueEl.setText(`${defaults.insetY}px`);
        radius.slider.setValue(defaults.radius);
        radius.valueEl.setText(`${defaults.radius}px`);
      })
      .buttonEl.classList.add("ach-nn-field-action");
    if (this.opts.tip) contentEl.createEl("p", { cls: "ach-nn-modal-note", text: this.opts.tip });

    const actions = contentEl.createDiv({ cls: "ach-nn-modal-actions" });
    new ButtonComponent(actions)
      .setButtonText("Apply")
      .setCta()
      .onClick(async () => {
        const name = this.nameValue.trim();
        if (this.opts.name !== undefined && !name) {
          new Notice("Enter a group name.");
          return;
        }
        const style = normalizeBorderStyle({
          startColor: this.startValue,
          endColor: this.endValue.trim() ? this.endValue : null,
          darkStartColor: this.darkEnabled ? this.darkStartValue : null,
          darkEndColor: this.darkEnabled && this.darkEndValue.trim() ? this.darkEndValue : null,
          insetX: this.insetXValue,
          insetY: this.insetYValue,
          radius: this.radiusValue,
        });
        if (!style || (this.darkEnabled && !style.darkStartColor)) {
          new Notice("Enter valid hex colors like #aabbcc.");
          return;
        }
        await this.opts.onApply(style, name);
        this.close();
      });
    if (this.opts.onClear) {
      new ButtonComponent(actions).setButtonText("Clear").onClick(async () => {
        await this.opts.onClear();
        this.close();
      });
    }
  }

  // Start/end color fields plus "solid" and "swap" buttons.
  renderColorPair(containerEl, pair) {
    const start = this.renderColorField(containerEl, {
      name: pair.startName,
      description: pair.startDescription,
      initialValue: pair.get().start,
      onChange: (value) => pair.set(value, pair.get().end),
    });
    const end = this.renderColorField(containerEl, {
      name: pair.endName,
      description: pair.endDescription,
      initialValue: pair.get().end || pair.get().start,
      textValue: pair.get().end,
      onChange: (value) => pair.set(pair.get().start, value),
    });
    const actions = containerEl.createDiv({ cls: "ach-nn-field-actions" });
    new ButtonComponent(actions)
      .setButtonText("Use solid border")
      .onClick(() => {
        const { start: startValue } = pair.get();
        pair.set(startValue, "");
        end.text.setValue("");
        end.picker.setValue(startValue);
      })
      .buttonEl.classList.add("ach-nn-field-action");
    new ButtonComponent(actions)
      .setButtonText("Swap colors")
      .onClick(() => {
        const { start: oldStart, end: oldEnd } = pair.get();
        const newStart = oldEnd || oldStart;
        pair.set(newStart, oldStart);
        start.text.setValue(newStart);
        start.picker.setValue(newStart);
        end.text.setValue(oldStart);
        end.picker.setValue(oldStart);
      })
      .buttonEl.classList.add("ach-nn-field-action");
    return { start, end };
  }

  renderColorField(containerEl, field) {
    let picker = null;
    let text = null;
    new Setting(containerEl)
      .setName(field.name)
      .setDesc(field.description)
      .addColorPicker((component) => {
        component.setValue(field.initialValue);
        component.onChange((value) => {
          field.onChange(value);
          text?.setValue(value);
        });
        picker = component;
      })
      .addText((component) => {
        component.setPlaceholder("#aabbcc");
        component.setValue(field.textValue ?? field.initialValue);
        component.onChange((value) => field.onChange(value.trim()));
        text = component;
      });
    renderRecentSwatches(containerEl, this.opts.recentColors, field.name, (color) => {
      field.onChange(color);
      text?.setValue(color);
      picker?.setValue(color);
    });
    if (!picker || !text) throw new Error(`Failed to render color field: ${field.name}`);
    return { picker, text };
  }

  renderSliderField(field) {
    let slider = null;
    const setting = new Setting(this.contentEl).setName(field.name).setDesc(field.description);
    setting.controlEl.addClass("ach-nn-slider-control");
    setting.addSlider((component) => {
      component.setLimits(field.min, field.max, field.step);
      component.setValue(field.initialValue);
      component.sliderEl.setAttribute("aria-label", field.name);
      component.onChange((value) => {
        field.onChange(value);
        valueEl.setText(field.formatValue(value));
      });
      slider = component;
    });
    const valueEl = setting.controlEl.createSpan({ cls: "ach-nn-slider-value", text: field.formatValue(field.initialValue) });
    if (!slider) throw new Error(`Failed to render slider field: ${field.name}`);
    return { slider, valueEl };
  }
}

class ConfirmModal extends Modal {
  constructor(app, { title, message, confirmText, onConfirm }) {
    super(app);
    this.opts = { title, message, confirmText, onConfirm };
  }

  onOpen() {
    this.setTitle(this.opts.title);
    this.contentEl.replaceChildren();
    this.contentEl.createEl("p", { text: this.opts.message });
    const actions = this.contentEl.createDiv({ cls: "ach-nn-modal-actions" });
    new ButtonComponent(actions)
      .setButtonText(this.opts.confirmText)
      .setWarning()
      .onClick(async () => {
        await this.opts.onConfirm();
        this.close();
      });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
  }
}

const FOLDER_COLOR_FIELDS = [
  { key: "color", name: "Text and icon color" },
  { key: "background", name: "Background" },
];
const SLOT_MODES = { follow: "Notebook Navigator", custom: "Custom color", none: "None" };

class FolderColorModal extends Modal {
  /**
   * opts: {
   *   path, current  - saved override or null
   *   nnColors       - Notebook Navigator's own { color, background }
   *   recentColors, onApply(override | null), onClear?
   * }
   */
  constructor(app, opts) {
    super(app);
    this.opts = opts;
    // slots[theme][key] = { mode: "follow" | "custom" | "none", custom: "#rrggbb" }
    this.slots = {};
    for (const theme of THEMES) {
      this.slots[theme] = {};
      for (const { key } of FOLDER_COLOR_FIELDS) {
        const value = opts.current?.[theme]?.[key] ?? null;
        this.slots[theme][key] = {
          mode: value === null ? "follow" : value === NO_COLOR ? "none" : "custom",
          custom: value && value !== NO_COLOR ? value : this.suggestedColor(key),
        };
      }
    }
  }

  // A custom slot starts from Notebook Navigator's color, so tweaking it is easy.
  suggestedColor(key) {
    const nnValue = normalizeFolderColorValue(this.opts.nnColors[key] ?? "");
    return nnValue && nnValue !== NO_COLOR ? nnValue : this.opts.recentColors[0] ?? DEFAULT_COLOR;
  }

  onOpen() {
    this.setTitle(`Folder colors: ${displayFolderPath(this.opts.path)}`);
    const { contentEl } = this;
    contentEl.replaceChildren();
    contentEl.createEl("p", {
      cls: "ach-nn-modal-note",
      text: "Notebook Navigator gives a folder one color for both modes. Choose what each mode shows; “Notebook Navigator” keeps its color in that mode. Subfolders follow when Notebook Navigator inherits folder colors.",
    });
    for (const theme of THEMES) {
      new Setting(contentEl).setName(theme === "dark" ? "Dark mode" : "Light mode").setHeading();
      for (const field of FOLDER_COLOR_FIELDS) this.renderSlot(contentEl, this.slots[theme][field.key], field);
    }

    const actions = contentEl.createDiv({ cls: "ach-nn-modal-actions" });
    new ButtonComponent(actions)
      .setButtonText("Apply")
      .setCta()
      .onClick(async () => {
        const override = this.buildOverride();
        if (override === undefined) {
          new Notice("Enter valid hex colors like #aabbcc.");
          return;
        }
        await this.opts.onApply(override);
        this.close();
      });
    if (this.opts.onClear) {
      new ButtonComponent(actions).setButtonText("Clear").onClick(async () => {
        await this.opts.onClear();
        this.close();
      });
    }
  }

  // null when every slot follows Notebook Navigator; undefined when a custom
  // color is not a valid hex color.
  buildOverride() {
    const override = {};
    for (const theme of THEMES) {
      for (const { key } of FOLDER_COLOR_FIELDS) {
        const slot = this.slots[theme][key];
        if (slot.mode === "follow") continue;
        const value = slot.mode === "none" ? NO_COLOR : normalizeFolderColorValue(slot.custom);
        if (!value) return undefined;
        override[theme] = { ...override[theme], [key]: value };
      }
    }
    return normalizeFolderColorOverride(override);
  }

  renderSlot(containerEl, slot, field) {
    let picker = null;
    let text = null;
    const setting = new Setting(containerEl)
      .setName(field.name)
      .setDesc(`Notebook Navigator: ${this.opts.nnColors[field.key] ?? "not set"}`);
    setting.settingEl.addClass("ach-nn-color-slot");
    setting.addDropdown((dropdown) =>
      dropdown
        .addOptions(SLOT_MODES)
        .setValue(slot.mode)
        .onChange((mode) => {
          slot.mode = mode;
          showCustom();
        }),
    );
    setting.addColorPicker((component) => {
      component.setValue(slot.custom.slice(0, 7));
      component.onChange((value) => {
        slot.custom = value;
        text?.setValue(value);
      });
      picker = component;
    });
    setting.addText((component) => {
      component
        .setPlaceholder("#aabbcc")
        .setValue(slot.custom)
        .onChange((value) => {
          slot.custom = value.trim();
          const hex = normalizeHexColor(slot.custom);
          if (hex) picker?.setValue(hex);
        });
      text = component;
    });
    const swatches = renderRecentSwatches(containerEl, this.opts.recentColors, field.name, (color) => {
      slot.custom = color;
      text?.setValue(color);
      picker?.setValue(color);
    });
    // The color inputs (hidden via CSS) and swatches only matter for a custom color.
    const showCustom = () => {
      const custom = slot.mode === "custom";
      setting.settingEl.toggleClass("is-custom", custom);
      swatches?.toggle(custom);
    };
    showCustom();
  }
}

class FolderSuggestModal extends FuzzySuggestModal {
  constructor(app, excludedPaths, onChoose) {
    super(app);
    this.excludedPaths = new Set(excludedPaths);
    this.onChoose = onChoose;
    this.setPlaceholder("Choose a folder to add to the group");
  }

  getItems() {
    return this.app.vault
      .getAllLoadedFiles()
      .filter((file) => file instanceof TFolder && !this.excludedPaths.has(file.path));
  }

  getItemText(folder) {
    return displayFolderPath(folder.path);
  }

  onChooseItem(folder) {
    this.onChoose(folder);
  }
}

class GroupSuggestModal extends SuggestModal {
  constructor(app, groups, onChoose) {
    super(app);
    this.groups = groups;
    this.onChoose = onChoose;
    this.setPlaceholder("Choose a border group");
  }

  getSuggestions(query) {
    const needle = query.trim().toLowerCase();
    const matches = this.groups.filter((group) => group.name.toLowerCase().includes(needle)).map((group) => ({ group }));
    return [...matches, { group: null }];
  }

  renderSuggestion(item, el) {
    if (!item.group) {
      el.setText("New group...");
      return;
    }
    el.addClass("ach-nn-group-suggestion");
    el.appendChild(createStylePreview(item.group.style));
    el.createSpan({ text: item.group.name });
    el.createSpan({ cls: "ach-nn-group-suggestion-count", text: `${item.group.folders.length} folders` });
  }

  onChooseSuggestion(item) {
    this.onChoose(item.group);
  }
}

// ---------------------------------------------------------------------------
// UI: settings tab
// ---------------------------------------------------------------------------

class BorderSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;
    const refresh = () => this.display();

    new Setting(containerEl).setName("Display").setHeading();
    new Setting(containerEl)
      .setName("Show folder borders")
      .setDesc("Borders set on single folders with “Change border style...”. Turning this off keeps them saved.")
      .addToggle((toggle) =>
        toggle.setValue(settings.showFolderBorders).onChange((value) => this.plugin.updateSettings({ showFolderBorders: value })),
      );
    new Setting(containerEl)
      .setName("Show group borders")
      .setDesc("One border around each block of grouped folders.")
      .addToggle((toggle) =>
        toggle.setValue(settings.showGroupBorders).onChange((value) => this.plugin.updateSettings({ showGroupBorders: value })),
      );
    new Setting(containerEl)
      .setName("Show folder colors")
      .setDesc("Light/dark text and background colors set with “Folder colors (light/dark)...”. Turning this off keeps them saved.")
      .addToggle((toggle) =>
        toggle.setValue(settings.showFolderColors).onChange((value) => this.plugin.updateSettings({ showFolderColors: value })),
      );
    new Setting(containerEl)
      .setName("Hide nested folder borders")
      .setDesc("When a bordered folder is expanded, bordered subfolders inside it don't get their own border.")
      .addToggle((toggle) =>
        toggle
          .setValue(settings.suppressNestedBorders)
          .onChange((value) => this.plugin.updateSettings({ suppressNestedBorders: value })),
      );

    new Setting(containerEl)
      .setName("Border groups")
      .setDesc(
        "Grouped folders that sit next to each other in the tree share one border. A folder belongs to one group; its expanded subfolders are inside the block. Width and default shape are in Style Settings → Group borders.",
      )
      .setHeading()
      .addButton((button) =>
        button
          .setButtonText("Add group")
          .setCta()
          .onClick(() => this.plugin.openGroupEditor(null, [], refresh)),
      );
    if (settings.borderGroups.length === 0) {
      containerEl.createDiv({ cls: "ach-nn-empty-note", text: "No groups yet. You can also right-click a folder → “Add to border group...”." });
    }
    for (const group of settings.borderGroups) this.renderGroup(containerEl, group, refresh);

    new Setting(containerEl).setName("Folder borders").setHeading();
    const folderPaths = Object.keys(settings.folderBorders).sort((a, b) => a.localeCompare(b));
    if (folderPaths.length === 0) {
      containerEl.createDiv({ cls: "ach-nn-empty-note", text: "No folder borders yet. Right-click a folder → “Change border style...”." });
    }
    for (const path of folderPaths) {
      const style = settings.folderBorders[path];
      const setting = new Setting(containerEl).setName(displayFolderPath(path));
      setting.nameEl.prepend(createStylePreview(style));
      setting.addExtraButton((button) =>
        button
          .setIcon("palette")
          .setTooltip("Edit border style")
          .onClick(() => this.plugin.openFolderEditor(path, refresh)),
      );
      setting.addExtraButton((button) =>
        button
          .setIcon("x")
          .setTooltip("Clear border")
          .onClick(async () => {
            await this.plugin.clearFolderBorder(path);
            refresh();
          }),
      );
    }

    new Setting(containerEl)
      .setName("Folder colors (light/dark)")
      .setDesc(
        "Text and background colors per mode, shown instead of Notebook Navigator's single folder color. Notebook Navigator's own settings are not changed.",
      )
      .setHeading();
    const colorPaths = Object.keys(settings.folderColorOverrides).sort((a, b) => a.localeCompare(b));
    if (colorPaths.length === 0) {
      containerEl.createDiv({ cls: "ach-nn-empty-note", text: "No folder colors yet. Right-click a folder → “Folder colors (light/dark)...”." });
    }
    for (const path of colorPaths) {
      const setting = new Setting(containerEl).setName(displayFolderPath(path));
      setting.nameEl.prepend(createFolderColorPreview(settings.folderColorOverrides[path], this.plugin.readNotebookNavigatorFolderColors(path)));
      setting.addExtraButton((button) =>
        button
          .setIcon("palette")
          .setTooltip("Edit folder colors")
          .onClick(() => this.plugin.openFolderColorEditor(path, refresh)),
      );
      setting.addExtraButton((button) =>
        button
          .setIcon("x")
          .setTooltip("Clear folder colors")
          .onClick(async () => {
            await this.plugin.clearFolderColors(path);
            refresh();
          }),
      );
    }
  }

  renderGroup(containerEl, group, refresh) {
    const setting = new Setting(containerEl).setName(group.name).setDesc(`${group.folders.length} folders`);
    setting.settingEl.addClass("ach-nn-group-setting");
    setting.nameEl.prepend(createStylePreview(group.style));
    setting.addExtraButton((button) =>
      button
        .setIcon("palette")
        .setTooltip("Edit name and colors")
        .onClick(() => this.plugin.openGroupEditor(group, group.folders, refresh)),
    );
    setting.addExtraButton((button) =>
      button
        .setIcon("folder-plus")
        .setTooltip("Add folder")
        .onClick(() =>
          new FolderSuggestModal(this.app, group.folders, async (folder) => {
            await this.plugin.addFolderToGroup(folder.path, group.id);
            refresh();
          }).open(),
        ),
    );
    setting.addExtraButton((button) =>
      button
        .setIcon("trash-2")
        .setTooltip("Delete group")
        .onClick(() =>
          new ConfirmModal(this.app, {
            title: "Delete border group",
            message: `Delete “${group.name}”? Its folders keep their own borders.`,
            confirmText: "Delete",
            onConfirm: async () => {
              await this.plugin.deleteGroup(group.id);
              refresh();
            },
          }).open(),
        ),
    );

    const members = containerEl.createDiv({ cls: "ach-nn-group-members" });
    if (group.folders.length === 0) members.createDiv({ cls: "ach-nn-group-member is-empty", text: "No folders yet." });
    for (const path of group.folders) {
      const row = members.createDiv({ cls: "ach-nn-group-member" });
      row.createSpan({ cls: "ach-nn-group-member-path", text: displayFolderPath(path) });
      new ExtraButtonComponent(row)
        .setIcon("x")
        .setTooltip("Remove from group")
        .onClick(async () => {
          await this.plugin.removeFolderFromGroup(path, group.id);
          refresh();
        });
    }
  }
}

// ---------------------------------------------------------------------------
// Notebook Navigator integration
// ---------------------------------------------------------------------------

function isNotebookNavigatorApi(value) {
  if (!value || typeof value !== "object") return false;
  return (
    typeof value.getVersion === "function" &&
    typeof value.isStorageReady === "function" &&
    typeof value.whenReady === "function" &&
    typeof value.on === "function" &&
    typeof value.off === "function" &&
    !!value.menus &&
    typeof value.menus.registerFolderMenu === "function"
  );
}

function getNotebookNavigatorApi(app) {
  const plugin = app.plugins?.plugins?.["notebook-navigator"];
  return plugin && isNotebookNavigatorApi(plugin.api) ? plugin.api : null;
}

function registerFolderMenu(plugin, api) {
  return api.menus.registerFolderMenu(({ addItem, folder }) => {
    const path = folder.path;
    const hasBorder = !!getOwn(plugin.settings.folderBorders, path);
    const group = plugin.findGroupOfFolder(path);

    addItem((item) => {
      item
        .setTitle("Change border style...")
        .setIcon("palette")
        .onClick(() => plugin.openFolderEditor(path));
    });
    addItem((item) => {
      item
        .setTitle("Clear border")
        .setIcon("x")
        .setDisabled(!hasBorder)
        .onClick(async () => {
          await plugin.clearFolderBorder(path);
          new Notice(`Border removed for ${path}`);
        });
    });
    addItem((item) => {
      item
        .setTitle("Folder colors (light/dark)...")
        .setIcon("sun-moon")
        .onClick(() => plugin.openFolderColorEditor(path));
    });
    addItem((item) => {
      item
        .setTitle(group ? "Move to border group..." : "Add to border group...")
        .setIcon("group")
        .onClick(() => plugin.openGroupPicker(path));
    });
    if (group) {
      addItem((item) => {
        item
          .setTitle(`Edit border group “${group.name}”...`)
          .setIcon("pencil")
          .onClick(() => plugin.openGroupEditor(group, group.folders));
      });
      addItem((item) => {
        item
          .setTitle(`Remove from border group “${group.name}”`)
          .setIcon("ungroup")
          .onClick(async () => {
            await plugin.removeFolderFromGroup(path, group.id);
            new Notice(`${path} removed from ${group.name}`);
          });
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

class AchmageNnBorderAddon extends Plugin {
  constructor(...args) {
    super(...args);
    this.settings = DEFAULT_SETTINGS;
    this.nn = null;
    this.overlay = new BorderOverlay(
      () => this.settings,
      () => this.checkFolderColorFlags(),
    );
    this.folderColorStyles = new FolderColorStyles();
    this.folderColorScheduler = new FrameScheduler();
    this.folderColorFlags = null;
    this.disposeFolderMenu = null;
    this.nnEventRefs = [];
    this.bootstrapInFlight = false;
    this.missingApiNoticeShown = false;
    this.styleObserver = null;
  }

  async onload() {
    this.settings = await loadSettings(this);
    this.addSettingTab(new BorderSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        if (this.nn) {
          this.attachToPanes();
          return;
        }
        this.bootstrap();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (!(file instanceof TFolder)) return;
        await this.updateFolderPaths({
          folderBorders: renameFolderKeys(this.settings.folderBorders, oldPath, file.path),
          borderGroups: renameGroupFolders(this.settings.borderGroups, oldPath, file.path),
          folderColorOverrides: renameFolderKeys(this.settings.folderColorOverrides, oldPath, file.path),
        });
        this.requestFolderColorRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (!(file instanceof TFolder)) return;
        await this.updateFolderPaths({
          folderBorders: removeFolderKeys(this.settings.folderBorders, file.path),
          borderGroups: removeGroupFolders(this.settings.borderGroups, file.path),
          folderColorOverrides: removeFolderKeys(this.settings.folderColorOverrides, file.path),
        });
        this.requestFolderColorRefresh();
      }),
    );
    // A new subfolder of an overridden folder inherits its colors.
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFolder) this.requestFolderColorRefresh();
      }),
    );

    this.installStyleObserver();
    this.app.workspace.onLayoutReady(() => {
      this.bootstrap();
    });
  }

  onunload() {
    this.disposeNotebookNavigatorIntegration();
    this.styleObserver?.disconnect();
    this.styleObserver = null;
  }

  requestFolderColorRefresh() {
    if (!this.nn) return;
    this.folderColorScheduler.request(() => this.refreshFolderColors());
  }

  refreshFolderColors() {
    const overrides = this.settings.folderColorOverrides;
    if (!this.nn || !this.settings.showFolderColors || Object.keys(overrides).length === 0) {
      this.folderColorFlags = null;
      this.folderColorStyles.remove();
      return;
    }
    const flags = readNotebookNavigatorColorFlags(this.app);
    this.folderColorFlags = `${flags.inherit}:${flags.colorIconOnly}`;
    this.folderColorStyles.apply(buildFolderColorCss(notebookNavigatorFolderTree(this.app, this.nn), overrides, flags));
  }

  // Notebook Navigator has no event for its own settings, but its tree
  // re-renders after a change, which reaches the overlay's observers.
  checkFolderColorFlags() {
    if (this.folderColorFlags === null) return;
    const flags = readNotebookNavigatorColorFlags(this.app);
    if (`${flags.inherit}:${flags.colorIconOnly}` !== this.folderColorFlags) this.requestFolderColorRefresh();
  }

  async bootstrap() {
    if (this.bootstrapInFlight) return;
    this.bootstrapInFlight = true;
    try {
      const api = getNotebookNavigatorApi(this.app);
      if (!api) {
        this.disposeNotebookNavigatorIntegration();
        if (!this.missingApiNoticeShown) {
          this.missingApiNoticeShown = true;
          new Notice("Achmage NN Border Add-on: Notebook Navigator not found.");
        }
        return;
      }
      this.missingApiNoticeShown = false;
      if (this.nn === api && this.disposeFolderMenu) {
        this.attachToPanes();
        return;
      }
      this.disposeNotebookNavigatorIntegration();
      this.nn = api;
      await api.whenReady();
      if (this.nn !== api) return;
      this.disposeFolderMenu = registerFolderMenu(this, api);
      this.registerNotebookNavigatorEvents(api);
      this.attachToPanes();
      this.requestFolderColorRefresh();
    } finally {
      this.bootstrapInFlight = false;
    }
  }

  // A newly opened Notebook Navigator view renders its panes a moment after
  // layout-change, so look again shortly afterwards.
  attachToPanes() {
    this.overlay.scanAndAttach();
    for (const delay of [100, 500, 1500]) {
      window.setTimeout(() => {
        if (this.nn) this.overlay.scanAndAttach();
      }, delay);
    }
  }

  registerNotebookNavigatorEvents(api) {
    this.disposeNotebookNavigatorEvents();
    for (const eventName of ["storage-ready", "nav-item-changed", "folder-changed"]) {
      this.nnEventRefs.push(api.on(eventName, () => this.overlay.requestRerenderAll()));
    }
    // A folder that gets or loses its own Notebook Navigator color changes
    // where inherited overrides stop.
    for (const eventName of ["storage-ready", "folder-changed"]) {
      this.nnEventRefs.push(api.on(eventName, () => this.requestFolderColorRefresh()));
    }
  }

  disposeNotebookNavigatorEvents() {
    if (!this.nn) {
      this.nnEventRefs = [];
      return;
    }
    for (const ref of this.nnEventRefs) this.nn.off(ref);
    this.nnEventRefs = [];
  }

  disposeNotebookNavigatorIntegration() {
    this.disposeFolderMenu?.();
    this.disposeFolderMenu = null;
    this.disposeNotebookNavigatorEvents();
    this.overlay.stop();
    this.folderColorStyles.remove();
    this.folderColorFlags = null;
    this.nn = null;
  }

  installStyleObserver() {
    this.styleObserver?.disconnect();
    const observer = new MutationObserver(() => this.overlay.requestRerenderAll());
    // Style Settings writes into <head>; light/dark switches toggle body classes.
    observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    this.styleObserver = observer;
  }

  async persistAndRender() {
    await saveSettings(this, this.settings);
    this.overlay.requestRerenderAll();
    this.requestFolderColorRefresh();
  }

  async updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    await this.persistAndRender();
  }

  // Folder renames/deletes only touch data.json when a saved path changed.
  async updateFolderPaths(patch) {
    const changed = Object.keys(patch).some((key) => JSON.stringify(patch[key]) !== JSON.stringify(this.settings[key]));
    if (!changed) return;
    await this.updateSettings(patch);
  }

  // --- folder borders -------------------------------------------------------

  openFolderEditor(path, onDone) {
    new BorderStyleModal(this.app, {
      title: `Border style: ${displayFolderPath(path)}`,
      currentStyle: getOwn(this.settings.folderBorders, path) ?? null,
      geometryDefaults: readGeometryDefaults(getComputedStyle(document.body), FOLDER_GEOMETRY),
      recentColors: this.settings.recentBorderColors,
      tip: "Tip: use global defaults if you want this folder to keep following Style Settings for shape and position.",
      onApply: async (style) => {
        await this.setFolderBorder(path, style);
        new Notice(`Border style saved for ${path}`);
        onDone?.();
      },
      onClear: async () => {
        await this.clearFolderBorder(path);
        new Notice(`Border removed for ${path}`);
        onDone?.();
      },
    }).open();
  }

  async setFolderBorder(path, style) {
    const compact = compactBorderStyle(style, readGeometryDefaults(getComputedStyle(document.body), FOLDER_GEOMETRY));
    this.settings = pushRecentColors(
      { ...this.settings, folderBorders: { ...this.settings.folderBorders, [path]: compact } },
      styleColors(style),
    );
    await this.persistAndRender();
  }

  async clearFolderBorder(path) {
    if (!getOwn(this.settings.folderBorders, path)) return;
    const folderBorders = { ...this.settings.folderBorders };
    delete folderBorders[path];
    await this.updateSettings({ folderBorders });
  }

  // --- border groups --------------------------------------------------------

  findGroupOfFolder(path) {
    return this.settings.borderGroups.find((group) => group.folders.includes(path)) ?? null;
  }

  openGroupPicker(path) {
    const current = this.findGroupOfFolder(path);
    const choices = this.settings.borderGroups.filter((group) => group !== current);
    new GroupSuggestModal(this.app, choices, async (group) => {
      if (!group) {
        this.openGroupEditor(null, [path]);
        return;
      }
      await this.addFolderToGroup(path, group.id);
      new Notice(`${path} added to ${group.name}`);
    }).open();
  }

  // group null creates a new group containing `folders`.
  openGroupEditor(group, folders, onDone) {
    const defaultStyle = normalizeBorderStyle(this.settings.recentBorderColors[0] ?? DEFAULT_COLOR);
    new BorderStyleModal(this.app, {
      title: group ? `Border group: ${group.name}` : "New border group",
      name: group ? group.name : `Group ${this.settings.borderGroups.length + 1}`,
      currentStyle: group ? group.style : defaultStyle,
      geometryDefaults: readGeometryDefaults(getComputedStyle(document.body), GROUP_GEOMETRY),
      recentColors: this.settings.recentBorderColors,
      tip: "Group border width and default shape live in Style Settings → Group borders.",
      onApply: async (style, name) => {
        await this.saveGroup({ id: group?.id ?? createGroupId(), name, folders: group ? group.folders : folders ?? [] }, style);
        onDone?.();
      },
    }).open();
  }

  async saveGroup(group, style) {
    const compact = compactBorderStyle(style, readGeometryDefaults(getComputedStyle(document.body), GROUP_GEOMETRY));
    const saved = { ...group, style: compact };
    const exists = this.settings.borderGroups.some((existing) => existing.id === group.id);
    // A folder belongs to one group: claiming it removes it from the others.
    const groups = this.settings.borderGroups.map((existing) =>
      existing.id === group.id ? saved : { ...existing, folders: existing.folders.filter((path) => !group.folders.includes(path)) },
    );
    this.settings = pushRecentColors(
      { ...this.settings, borderGroups: exists ? groups : [...groups, saved] },
      styleColors(style),
    );
    await this.persistAndRender();
  }

  async deleteGroup(groupId) {
    await this.updateSettings({ borderGroups: this.settings.borderGroups.filter((group) => group.id !== groupId) });
  }

  async addFolderToGroup(path, groupId) {
    await this.updateSettings({
      borderGroups: this.settings.borderGroups.map((group) => {
        if (group.id === groupId) return group.folders.includes(path) ? group : { ...group, folders: [...group.folders, path] };
        return { ...group, folders: group.folders.filter((folder) => folder !== path) };
      }),
    });
  }

  async removeFolderFromGroup(path, groupId) {
    await this.updateSettings({
      borderGroups: this.settings.borderGroups.map((group) =>
        group.id === groupId ? { ...group, folders: group.folders.filter((folder) => folder !== path) } : group,
      ),
    });
  }

  // --- folder colors --------------------------------------------------------

  // The folder's own Notebook Navigator colors (not inherited ones).
  readNotebookNavigatorFolderColors(path) {
    const folder = folderAtPath(this.app, path);
    const meta = folder ? this.nn?.metadata?.getFolderMeta?.(folder) : null;
    return { color: meta?.color ?? null, background: meta?.backgroundColor ?? null };
  }

  openFolderColorEditor(path, onDone) {
    const current = getOwn(this.settings.folderColorOverrides, path) ?? null;
    new FolderColorModal(this.app, {
      path,
      current,
      nnColors: this.readNotebookNavigatorFolderColors(path),
      recentColors: this.settings.recentBorderColors,
      onApply: async (override) => {
        await this.setFolderColors(path, override);
        new Notice(override ? `Folder colors saved for ${path}` : `Folder colors removed for ${path}`);
        onDone?.();
      },
      onClear: current
        ? async () => {
            await this.clearFolderColors(path);
            new Notice(`Folder colors removed for ${path}`);
            onDone?.();
          }
        : undefined,
    }).open();
  }

  async setFolderColors(path, override) {
    const normalized = normalizeFolderColorOverride(override);
    if (!normalized) {
      await this.clearFolderColors(path);
      return;
    }
    this.settings = pushRecentColors(
      { ...this.settings, folderColorOverrides: { ...this.settings.folderColorOverrides, [path]: normalized } },
      overrideColors(normalized),
    );
    await this.persistAndRender();
  }

  async clearFolderColors(path) {
    if (!getOwn(this.settings.folderColorOverrides, path)) return;
    const folderColorOverrides = { ...this.settings.folderColorOverrides };
    delete folderColorOverrides[path];
    await this.updateSettings({ folderColorOverrides });
  }
}

module.exports = AchmageNnBorderAddon;
module.exports.default = AchmageNnBorderAddon;
