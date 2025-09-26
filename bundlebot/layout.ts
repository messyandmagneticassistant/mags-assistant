import fs from "fs/promises";
import path from "path";
import { runWithGemini } from "../lib/clients/gemini";
import { getBrowserlessOptions } from "../src/clients/browserless";

export interface LayoutRequest {
  icons: string[];
  style: "child" | "adult" | string;
  theme: string;
  gridSize?: string;
}

export interface LayoutPlan {
  grid: Array<LayoutGroup | string[]>;
  layoutType?: string;
  instructions?: string;
}

export interface LayoutGroup {
  header?: string;
  items: string[];
}

export interface GenerateLayoutOptions {
  outputPath?: string;
  debugHtmlPath?: string;
  forceMock?: boolean;
}

export interface GenerateLayoutResult {
  plan: NormalizedLayoutPlan;
  screenshotPath: string;
  htmlPath?: string;
}

export interface NormalizedLayoutPlan {
  groups: NormalizedGroup[];
  layoutType?: string;
  instructions?: string;
  requestedGrid?: ParsedGridSize | null;
}

export interface NormalizedGroup {
  header?: string;
  items: string[];
}

export interface ParsedGridSize {
  columns: number;
  rows: number;
  label: string;
}

interface GeminiLayoutResponse {
  grid?: Array<LayoutGroup | string[]>;
  layoutType?: string;
  instructions?: string;
}

const DEFAULT_OUTPUT_PATH = "/tmp/layout.png";

/**
 * Generate a visual layout for a bundle of icons. The function will request a layout plan
 * from Gemini (with a mock fallback), render the layout using Browserless/Puppeteer, and
 * save a PNG screenshot to the filesystem.
 */
export async function generateLayout(
  request: LayoutRequest,
  options: GenerateLayoutOptions = {},
): Promise<GenerateLayoutResult> {
  validateRequest(request);

  const parsedGrid = parseGridSize(request.gridSize);
  const plan = await getLayoutPlan(request, { forceMock: options.forceMock });
  const normalizedPlan = normalizeLayoutPlan(plan, request.icons, parsedGrid);

  const html = buildHtml(normalizedPlan, request);
  const screenshotPath = options.outputPath ?? DEFAULT_OUTPUT_PATH;

  const htmlPath = options.debugHtmlPath
    ? await persistHtml(options.debugHtmlPath, html)
    : undefined;

  await renderPlanToImage(html, screenshotPath, normalizedPlan);

  return {
    plan: normalizedPlan,
    screenshotPath,
    htmlPath,
  };
}

function validateRequest(request: LayoutRequest) {
  if (!request || !Array.isArray(request.icons)) {
    throw new Error("generateLayout requires a payload with an icons array.");
  }
  if (!request.icons.length) {
    throw new Error("At least one icon label is required to build a layout.");
  }
  if (!request.style) {
    throw new Error('A style is required (e.g. "child" or "adult").');
  }
  if (!request.theme) {
    throw new Error('A theme identifier (e.g. "blue-pastel") is required.');
  }
}

async function getLayoutPlan(
  request: LayoutRequest,
  { forceMock = false }: { forceMock?: boolean },
): Promise<LayoutPlan> {
  if (!forceMock) {
    try {
      const plan = await callGeminiForLayout(request);
      if (plan && Array.isArray(plan.grid) && plan.grid.length > 0) {
        return plan;
      }
    } catch (err) {
      console.warn(
        "[bundlebot] Gemini layout generation failed, falling back to mock:",
        err,
      );
    }
  }
  return buildMockLayoutPlan(request);
}

async function callGeminiForLayout(
  request: LayoutRequest,
): Promise<LayoutPlan> {
  const context =
    `You are BundleBot, an AI designer crafting magnetic schedule layouts. \n` +
    `Given a set of icon labels, suggest how to group them by routine or time of day. ` +
    `Return JSON with keys: grid (array of groups), layoutType (string), instructions (string). ` +
    `Each group can be either {"header": "Morning", "items": [ ... ]} or an array where the first entry is an optional header.`;

  const prompt =
    `Icons: ${request.icons.join(", ")}\n` +
    `Preferred style: ${request.style}\n` +
    `Theme: ${request.theme}\n` +
    `Requested grid size: ${request.gridSize ?? "auto"}\n` +
    `Please respond with JSON only.`;

  const raw = await runWithGemini({
    agentName: "BundleBot",
    role: "Magnet Layout Designer",
    context,
    task: prompt,
    fallbackToAppsScript: false,
  });

  const parsed = extractJson<GeminiLayoutResponse>(raw);
  if (!parsed || !parsed.grid) {
    throw new Error("Gemini did not return a usable grid.");
  }

  return {
    grid: parsed.grid,
    layoutType: parsed.layoutType,
    instructions: parsed.instructions,
  };
}

function extractJson<T = any>(raw: string): T | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  } catch (err) {
    console.warn("[bundlebot] Failed to parse Gemini JSON:", err, raw);
    return null;
  }
}

function buildMockLayoutPlan(request: LayoutRequest): LayoutPlan {
  const segments = {
    morning: ["wake", "breakfast", "school", "bus"],
    afternoon: ["lunch", "snack", "play", "home"],
    evening: ["dinner", "bath", "bed", "story"],
    chores: ["clean", "laundry", "tidy", "chores"],
  };

  const groups: NormalizedGroup[] = [];
  const used = new Set<string>();

  function allocate(header: string, matchers: string[]) {
    const items: string[] = [];
    for (const icon of request.icons) {
      if (used.has(icon)) continue;
      const normalized = icon.toLowerCase();
      if (matchers.some((m) => normalized.includes(m))) {
        items.push(icon);
        used.add(icon);
      }
    }
    if (items.length) {
      groups.push({ header, items });
    }
  }

  allocate("Morning", segments.morning);
  allocate("Afternoon", segments.afternoon);
  allocate("Evening", segments.evening);
  allocate("Chores", segments.chores);

  const remaining = request.icons.filter((icon) => !used.has(icon));
  if (remaining.length) {
    groups.push({ header: "Anytime", items: remaining });
  }

  return {
    grid: groups,
    layoutType: request.gridSize ?? "auto",
    instructions: `Mock layout used. Style: ${request.style}, theme: ${request.theme}`,
  };
}

function normalizeLayoutPlan(
  plan: LayoutPlan,
  icons: string[],
  parsedGrid: ParsedGridSize | null,
): NormalizedLayoutPlan {
  const iconSet = new Set(icons);
  const groups: NormalizedGroup[] = [];

  for (const entry of plan.grid ?? []) {
    if (!entry) continue;
    if (Array.isArray(entry)) {
      if (!entry.length) continue;
      const [first, ...rest] = entry;
      const header = first && !iconSet.has(first) ? first : undefined;
      const items = (header ? rest : entry).filter(
        (value): value is string =>
          typeof value === "string" && value.trim() !== "",
      );
      groups.push({ header, items });
    } else if (typeof entry === "object") {
      const header =
        typeof entry.header === "string" ? entry.header : undefined;
      const items = Array.isArray(entry.items)
        ? entry.items.filter(
            (value): value is string =>
              typeof value === "string" && value.trim() !== "",
          )
        : [];
      groups.push({ header, items });
    }
  }

  if (!groups.length) {
    groups.push({ items: icons });
  }

  return {
    groups,
    layoutType: plan.layoutType ?? parsedGrid?.label,
    instructions: plan.instructions,
    requestedGrid: parsedGrid,
  };
}

function parseGridSize(gridSize?: string): ParsedGridSize | null {
  if (!gridSize) return null;
  const match = gridSize.match(/^(\d+)\s*[xX]\s*(\d+)$/);
  if (!match) return null;
  const columns = Number.parseInt(match[1], 10);
  const rows = Number.parseInt(match[2], 10);
  if (!columns || !rows) return null;
  return { columns, rows, label: `${columns}x${rows}` };
}

function buildHtml(plan: NormalizedLayoutPlan, request: LayoutRequest): string {
  const theme = resolveTheme(request.theme);
  const fontFamily =
    request.style === "adult"
      ? `'Inter', sans-serif`
      : `'Fredoka', 'Poppins', sans-serif`;
  const inferredColumns = plan.groups.reduce(
    (max, group) => Math.max(max, group.items.length + (group.header ? 1 : 0)),
    0,
  );
  const columnCount =
    plan.requestedGrid?.columns ?? Math.max(3, inferredColumns);

  const cells = plan.groups
    .map((group) => {
      const headerHtml = group.header
        ? `<div class="group-header">${escapeHtml(group.header)}</div>`
        : "";
      const itemHtml = group.items
        .map((item) => `<div class="icon-cell">${escapeHtml(item)}</div>`)
        .join("");
      return `<section class="group">${headerHtml}<div class="icon-grid">${itemHtml}</div></section>`;
    })
    .join("");

  const instructions = plan.instructions
    ? `<footer class="instructions">${escapeHtml(plan.instructions)}</footer>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>BundleBot Layout</title>
  <style>
    :root {
      --bg: ${theme.background};
      --fg: ${theme.foreground};
      --accent: ${theme.accent};
      --column-count: ${columnCount};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px;
      font-family: ${fontFamily};
      background: var(--bg);
      color: var(--fg);
      display: flex;
      flex-direction: column;
      gap: 24px;
      width: 100%;
    }
    h1 {
      font-size: 28px;
      margin: 0 0 12px;
      letter-spacing: 0.02em;
      text-align: center;
    }
    .layout-wrapper {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .group {
      background: rgba(255, 255, 255, 0.72);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 12px 35px rgba(15, 23, 42, 0.1);
    }
    .group-header {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--accent);
      text-transform: capitalize;
      letter-spacing: 0.04em;
    }
    .icon-grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(${theme.cellMinWidth}px, 1fr));
    }
    .icon-cell {
      background: ${theme.cardBackground};
      border-radius: 16px;
      padding: 18px 16px;
      text-align: center;
      font-size: 18px;
      line-height: 1.25;
      font-weight: 600;
      color: ${theme.cardForeground};
      border: 2px solid rgba(255, 255, 255, 0.8);
      box-shadow: inset 0 -6px 0 rgba(255, 255, 255, 0.45);
      transition: transform 0.2s ease;
    }
    .icon-cell:hover {
      transform: translateY(-4px);
    }
    .instructions {
      font-size: 14px;
      opacity: 0.75;
      text-align: center;
      padding: 12px 18px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.4);
      border: 1px dashed rgba(0, 0, 0, 0.1);
    }
  </style>
</head>
<body>
  <h1>${request.style === "adult" ? "Rhythm Planning Layout" : "Daily Rhythm Board"}</h1>
  <div class="layout-wrapper">${cells}</div>
  ${instructions}
</body>
</html>`;
}

function resolveTheme(theme: string) {
  const defaults = {
    background: "#f2f4ff",
    foreground: "#1f2933",
    accent: "#4c6ef5",
    cardBackground: "rgba(255,255,255,0.92)",
    cardForeground: "#1f2933",
    cellMinWidth: 160,
  };

  const themes: Record<string, Partial<typeof defaults>> = {
    "blue-pastel": {
      background: "linear-gradient(160deg, #dff1ff 0%, #f2f4ff 100%)",
      accent: "#2a6af1",
      cardBackground: "rgba(255, 255, 255, 0.95)",
      cellMinWidth: 170,
    },
    sunrise: {
      background: "linear-gradient(180deg, #ffe9d6 0%, #ffd1dc 100%)",
      accent: "#ff7a59",
      cardForeground: "#7a2e10",
    },
    forest: {
      background: "linear-gradient(160deg, #d1f8e9 0%, #f1fff8 100%)",
      accent: "#0f9d58",
      cardForeground: "#0d4230",
    },
  };

  const override = themes[theme] ?? {};
  return { ...defaults, ...override };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function persistHtml(targetPath: string, html: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, html, "utf8");
  return resolved;
}

async function renderPlanToImage(
  html: string,
  outputPath: string,
  plan: NormalizedLayoutPlan,
) {
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    throw new Error(
      "Puppeteer is not available. Install puppeteer or puppeteer-core.",
    );
  }

  const viewport = calculateViewport(plan);
  let browser: any;
  try {
    const browserlessOptions = resolveBrowserlessConnectOptions();
    if (browserlessOptions) {
      browser = await puppeteer.connect(browserlessOptions);
    } else if (typeof puppeteer.launch === "function") {
      browser = await puppeteer.launch({
        headless: "new" as any,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    } else {
      throw new Error(
        "No Browserless credentials and puppeteer.launch is unavailable.",
      );
    }

    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.setContent(html, { waitUntil: "networkidle0" });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, type: "png", fullPage: true });
    await page.close();
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function loadPuppeteer(): Promise<any | null> {
  try {
    return await import("puppeteer-core");
  } catch (coreError) {
    try {
      return await import("puppeteer");
    } catch (fullError) {
      console.warn(
        "[bundlebot] Puppeteer not available:",
        coreError,
        fullError,
      );
      return null;
    }
  }
}

function resolveBrowserlessConnectOptions(): Record<string, unknown> | null {
  const explicit =
    process.env.BROWSERLESS_WS_ENDPOINT ||
    process.env.BROWSERLESS_ENDPOINT ||
    process.env.BROWSERLESS_URL;
  if (explicit) {
    return {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      browserWSEndpoint: normalizeWsEndpoint(explicit),
    };
  }

  const options = getBrowserlessOptions();
  const endpoint = options?.browserWSEndpoint;
  if (endpoint && !endpoint.includes("undefined")) {
    return options;
  }

  const token =
    process.env.BROWSERLESS_API_KEY ||
    process.env.BROWSERLESS_TOKEN ||
    process.env.BROWSERLESS_KEY ||
    process.env.BROWSERLESS_SECRET ||
    null;
  if (!token) {
    return null;
  }

  const base =
    process.env.BROWSERLESS_BASE_URL ||
    process.env.BROWSERLESS_HOST ||
    "wss://chrome.browserless.io";
  const normalizedBase = normalizeWsEndpoint(base);
  const url = normalizedBase.includes("token=")
    ? normalizedBase
    : `${normalizedBase}${normalizedBase.includes("?") ? "&" : "?"}token=${encodeURIComponent(
        token,
      )}`;

  return {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    browserWSEndpoint: url,
  };
}

function normalizeWsEndpoint(raw: string) {
  if (raw.startsWith("http")) {
    return raw.replace(/^http/i, "ws");
  }
  return raw;
}

function calculateViewport(plan: NormalizedLayoutPlan) {
  const inferredColumns = plan.groups.reduce(
    (max, group) => Math.max(max, group.items.length || 1),
    0,
  );
  const columnCount =
    plan.requestedGrid?.columns ?? Math.max(3, inferredColumns);
  const inferredRows = plan.groups.length;
  const rowCount = plan.requestedGrid?.rows ?? Math.max(3, inferredRows + 1);
  const width = Math.min(1920, Math.max(800, columnCount * 220));
  const height = Math.min(2160, Math.max(720, rowCount * 180));
  return { width, height, deviceScaleFactor: 2 };
}
