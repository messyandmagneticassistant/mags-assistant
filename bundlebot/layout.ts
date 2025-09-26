import { launch } from 'puppeteer-core';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

import { getBrowserlessOptions } from '../src/clients/browserless';
import { callGeminiJSON } from '../src/clients/gemini';

type GridSize = `${number}x${number}`;

type LayoutFormat = 'png' | 'pdf';

export interface BundleLayoutRequest {
  icons: string[];
  style?: 'child' | 'adult' | 'minimal' | string;
  theme?: string;
  gridSize?: GridSize;
  annotations?: string[];
  format?: LayoutFormat;
}

export interface LayoutGroupPlan {
  label?: string;
  icons: string[];
}

export interface LayoutPlan {
  columns: number;
  rows: number;
  groups: LayoutGroupPlan[];
  annotations?: string[];
}

export interface BundleLayoutResponse {
  layoutSVG: string;
  iconGrid: string[];
  screenshotPath?: string;
  metadata: LayoutPlan;
}

const TMP_DIR = process.env.BUNDLEBOT_TMP_DIR || '/tmp';

const DEFAULT_VIEWPORT = {
  width: 1200,
  height: 900,
  deviceScaleFactor: 2,
};

const THEME_PALETTES: Record<string, { background: string; card: string; accent: string; text: string }> = {
  'blue-pastel': {
    background: '#e7f1ff',
    card: '#ffffff',
    accent: '#9bbcff',
    text: '#1f2d3d',
  },
  'sunrise': {
    background: '#fff3e0',
    card: '#ffffff',
    accent: '#ffb74d',
    text: '#5d4037',
  },
};

const DEFAULT_THEME = {
  background: '#f5f5f5',
  card: '#ffffff',
  accent: '#d0d0d0',
  text: '#1a1a1a',
};

function coerceGridSize(gridSize: GridSize | undefined, iconCount: number): { columns: number; rows: number } {
  if (gridSize) {
    const [rawColumns, rawRows] = gridSize.split('x').map((value) => parseInt(value, 10));
    if (Number.isFinite(rawColumns) && Number.isFinite(rawRows) && rawColumns > 0 && rawRows > 0) {
      return { columns: rawColumns, rows: rawRows };
    }
  }

  const maxColumns = 5;
  let columns = Math.min(maxColumns, Math.ceil(Math.sqrt(iconCount)));
  if (columns < 3) columns = Math.max(2, columns);
  const rows = Math.max(1, Math.ceil(iconCount / columns));
  return { columns, rows };
}

const KEYWORD_GROUPS: Record<string, string[]> = {
  Morning: ['wake', 'breakfast', 'brush', 'teeth', 'dress'],
  School: ['school', 'class', 'homework', 'study'],
  Family: ['family', 'mom', 'dad', 'together'],
  Chores: ['clean', 'room', 'laundry', 'chores', 'dishes'],
  Relax: ['play', 'tablet', 'story', 'fun', 'relax', 'snack'],
  Evening: ['dinner', 'bed', 'bath', 'night'],
};

function inferGroupLabel(icon: string): string {
  const lower = icon.toLowerCase();
  for (const [label, keywords] of Object.entries(KEYWORD_GROUPS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return label;
    }
  }
  return 'Other';
}

function buildGroupsWithHeuristics(icons: string[]): LayoutGroupPlan[] {
  const grouped: Record<string, string[]> = {};
  for (const icon of icons) {
    const label = inferGroupLabel(icon);
    grouped[label] = grouped[label] || [];
    grouped[label].push(icon);
  }

  return Object.entries(grouped)
    .sort(([labelA], [labelB]) => labelA.localeCompare(labelB))
    .map(([label, groupIcons]) => ({
      label: label === 'Other' && groupIcons.length === 1 ? undefined : label,
      icons: groupIcons,
    }));
}

async function callGeminiForLayoutPlan(request: BundleLayoutRequest, fallbackGroups: LayoutGroupPlan[]): Promise<LayoutPlan> {
  const iconCount = request.icons.length;
  const baseGrid = coerceGridSize(request.gridSize, iconCount);
  const fallbackPlan: LayoutPlan = {
    ...baseGrid,
    groups: fallbackGroups,
    annotations: request.annotations && request.annotations.length > 0 ? request.annotations : undefined,
  };

  const prompt = buildGeminiPrompt(request, baseGrid);

  try {
    const rawPlan = await callGeminiJSON<GeminiLayoutPlan>(prompt, {
      model: process.env.GEMINI_LAYOUT_MODEL || 'gemini-1.5-pro',
      temperature: 0.35,
    });

    const normalized = normalizeGeminiPlan(rawPlan, fallbackPlan, request);
    return normalized;
  } catch (error) {
    console.warn('[BundleBot] Gemini layout plan failed – falling back to heuristics:', error);
    return fallbackPlan;
  }
}

type GeminiLayoutPlan = {
  columns?: number;
  rows?: number;
  groups?: Array<{
    label?: string | null;
    icons?: string[];
  }>;
  annotations?: string[];
};

function buildGeminiPrompt(request: BundleLayoutRequest, grid: { columns: number; rows: number }): string {
  const iconList = request.icons.map((icon) => `- ${icon}`).join('\n');
  const style = request.style ? `Preferred style: ${request.style}.` : '';
  const theme = request.theme ? `Theme: ${request.theme}.` : 'Use a calm but legible palette if none specified.';
  const annotationHint = request.annotations?.length
    ? `These notes should appear as annotations: ${request.annotations.join(', ')}.`
    : 'Include annotations only if they add clarity to the routine.';
  const formatHint = request.format === 'pdf' ? 'The layout should print cleanly on letter-sized paper.' : '';

  return `You are a layout designer generating printable magnet board layouts for Maggie. You will receive a list of icon labels and should group them into a meaningful grid for families.

Instructions:
- Only use the provided icon labels without changing their text.
- Suggest a grid within ${grid.columns} columns by ${grid.rows} rows unless you have a better idea that still fits every icon.
- Icons may be grouped by routine (Morning, School, Family, etc.). Add group labels if they are helpful, otherwise omit them.
- Keep groups small (between 2 and 6 icons) and balanced.
- Return strictly JSON following this schema:
{
  "columns": number,
  "rows": number,
  "groups": [
    { "label": string | null, "icons": string[] }
  ],
  "annotations": string[] (optional)
}

Context:
${style}
${theme}
${annotationHint}
${formatHint}

Icons to place (in order of preference):
${iconList}

Ensure every icon from the list appears exactly once in the groups. If you cannot improve the grouping, copy the provided order but keep the JSON structure.`;
}

function normalizeGeminiPlan(plan: GeminiLayoutPlan, fallback: LayoutPlan, request: BundleLayoutRequest): LayoutPlan {
  if (!plan || typeof plan !== 'object') {
    return fallback;
  }

  const allIcons = request.icons;
  const seen = new Set<string>();
  const normalizedGroups: LayoutGroupPlan[] = [];

  if (Array.isArray(plan.groups)) {
    for (const group of plan.groups) {
      if (!group || !Array.isArray(group.icons)) continue;
      const cleanedIcons = group.icons
        .map((icon) => icon?.trim())
        .filter((icon): icon is string => Boolean(icon) && allIcons.includes(icon) && !seen.has(icon));

      if (cleanedIcons.length === 0) continue;

      cleanedIcons.forEach((icon) => seen.add(icon));

      const label = typeof group.label === 'string' && group.label.trim().length > 0 ? group.label.trim() : undefined;
      normalizedGroups.push({ label, icons: cleanedIcons });
    }
  }

  if (seen.size < allIcons.length) {
    const leftovers = allIcons.filter((icon) => !seen.has(icon));

    for (const icon of leftovers) {
      const fallbackGroup = fallback.groups.find((group) => group.icons.includes(icon));
      if (!fallbackGroup) continue;
      let target = normalizedGroups.find((group) => group.label === fallbackGroup.label);
      if (!target) {
        target = { label: fallbackGroup.label, icons: [] };
        normalizedGroups.push(target);
      }
      target.icons.push(icon);
      seen.add(icon);
    }
  }

  const hasValidGroups = normalizedGroups.length > 0 && normalizedGroups.some((group) => group.icons.length > 0);
  if (!hasValidGroups || seen.size !== allIcons.length) {
    return fallback;
  }

  const totalIcons = allIcons.length;
  const suggestedColumns = Number(plan.columns);
  const validColumns = Number.isFinite(suggestedColumns) && suggestedColumns > 0 && suggestedColumns <= 8
    ? Math.floor(suggestedColumns)
    : fallback.columns;

  const suggestedRows = Number(plan.rows);
  const minimumRows = Math.ceil(totalIcons / Math.max(1, validColumns));
  const validRows = Number.isFinite(suggestedRows) && suggestedRows >= minimumRows
    ? Math.floor(suggestedRows)
    : Math.max(fallback.rows, minimumRows);

  const annotations = Array.isArray(plan.annotations)
    ? plan.annotations.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : fallback.annotations;

  return {
    columns: validColumns,
    rows: validRows,
    groups: normalizedGroups,
    annotations: annotations && annotations.length > 0 ? annotations : undefined,
  };
}

function getTheme(theme?: string) {
  if (!theme) return DEFAULT_THEME;
  const palette = THEME_PALETTES[theme];
  if (palette) return palette;
  return DEFAULT_THEME;
}

function renderLayoutHTML(plan: LayoutPlan, request: BundleLayoutRequest): string {
  const theme = getTheme(request.theme);
  const gridTemplateColumns = `repeat(${plan.columns}, minmax(0, 1fr))`;

  const groupSections = plan.groups
    .map((group) => {
      const labelMarkup = group.label ? `<h3 class=\"group-label\">${group.label}</h3>` : '';
      const iconsMarkup = group.icons
        .map((icon) => `<div class=\"icon-card\">${icon}</div>`)
        .join('');
      return `<section class=\"group\">${labelMarkup}<div class=\"group-grid\">${iconsMarkup}</div></section>`;
    })
    .join('');

  const annotations = plan.annotations?.length
    ? `<footer class=\"annotations\">${plan.annotations.map((note) => `<span>${note}</span>`).join('')}</footer>`
    : '';

  return `<!DOCTYPE html>
<html lang=\"en\">
  <head>
    <meta charSet=\"utf-8\" />
    <title>BundleBot Layout</title>
    <style>
      :root {
        color-scheme: light;
        font-family: 'Nunito', 'Helvetica Neue', sans-serif;
        background: ${theme.background};
        color: ${theme.text};
      }
      body {
        margin: 0;
        padding: 32px;
        background: ${theme.background};
      }
      main {
        display: grid;
        grid-template-columns: ${gridTemplateColumns};
        gap: 24px;
      }
      section.group {
        background: ${theme.card};
        border-radius: 18px;
        box-shadow: 0 10px 30px rgba(31, 45, 61, 0.1);
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .group-label {
        margin: 0;
        font-weight: 700;
        font-size: 1.25rem;
        color: ${theme.text};
      }
      .group-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 12px;
      }
      .icon-card {
        background: ${theme.background};
        border-radius: 14px;
        padding: 16px;
        text-align: center;
        font-weight: 600;
        color: ${theme.text};
        border: 2px solid ${theme.accent};
      }
      footer.annotations {
        margin-top: 32px;
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        font-size: 0.95rem;
        color: ${theme.text};
      }
      footer.annotations span {
        background: ${theme.card};
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid ${theme.accent};
      }
    </style>
  </head>
  <body>
    <main>
      ${groupSections}
    </main>
    ${annotations}
  </body>
</html>`;
}

function renderLayoutSVG(plan: LayoutPlan, request: BundleLayoutRequest): string {
  const theme = getTheme(request.theme);
  const cellWidth = 240;
  const cellHeight = 200;
  const padding = 24;
  const width = plan.columns * cellWidth + padding * 2;
  const height = plan.rows * cellHeight + padding * 2;

  const cells: string[] = [];
  let currentColumn = 0;
  let currentRow = 0;

  for (const group of plan.groups) {
    for (const icon of group.icons) {
      const x = padding + currentColumn * cellWidth;
      const y = padding + currentRow * cellHeight;
      cells.push(`
        <g>
          <rect x=\"${x}\" y=\"${y}\" width=\"${cellWidth - 16}\" height=\"${cellHeight - 16}\" rx=\"20\" fill=\"${theme.card}\" stroke=\"${theme.accent}\" stroke-width=\"4\" />
          <text x=\"${x + (cellWidth - 16) / 2}\" y=\"${y + (cellHeight - 16) / 2}\" dominant-baseline=\"middle\" text-anchor=\"middle\" font-size=\"20\" font-weight=\"600\" fill=\"${theme.text}\">${icon}</text>
        </g>
      `);

      currentColumn += 1;
      if (currentColumn >= plan.columns) {
        currentColumn = 0;
        currentRow += 1;
      }
    }
  }

  return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\" role=\"img\" aria-label=\"Bundle icon layout\">
  <rect width=\"100%\" height=\"100%\" fill=\"${theme.background}\" />
  ${cells.join('\n')}
</svg>`;
}

async function captureLayoutArtifact(html: string, plan: LayoutPlan, format: LayoutFormat): Promise<string> {
  const fileName = `bundlebot-layout-${Date.now()}-${crypto.randomUUID()}.${format}`;
  const outPath = path.join(TMP_DIR, fileName);

  await fs.mkdir(TMP_DIR, { recursive: true });

  const browser = await launch(getBrowserlessOptions());
  try {
    const page = await browser.newPage();
    await page.setViewport(DEFAULT_VIEWPORT);
    await page.setContent(html, { waitUntil: 'networkidle0' });

    if (format === 'pdf') {
      await page.pdf({
        path: outPath,
        width: `${DEFAULT_VIEWPORT.width}px`,
        height: `${DEFAULT_VIEWPORT.height}px`,
        printBackground: true,
      });
    } else {
      await page.screenshot({
        path: outPath,
        type: 'png',
        fullPage: true,
      });
    }
  } finally {
    await browser.close();
  }

  return outPath;
}

function normalizeRequestData(raw: Partial<BundleLayoutRequest>): BundleLayoutRequest {
  const icons = Array.isArray(raw.icons) ? raw.icons.filter((icon): icon is string => typeof icon === 'string' && icon.trim().length > 0) : [];

  if (icons.length === 0) {
    throw new Error('At least one icon label must be provided.');
  }
  if (icons.length > 30) {
    throw new Error('A maximum of 30 icons are supported for layout generation.');
  }

  return {
    icons,
    style: raw.style,
    theme: raw.theme,
    gridSize: raw.gridSize,
    annotations: Array.isArray(raw.annotations) ? raw.annotations.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : undefined,
    format: raw.format === 'pdf' ? 'pdf' : 'png',
  };
}

export async function generateBundleLayout(raw: Partial<BundleLayoutRequest>): Promise<BundleLayoutResponse> {
  const request = normalizeRequestData(raw);
  const heuristics = buildGroupsWithHeuristics(request.icons);
  const plan = await callGeminiForLayoutPlan(request, heuristics);
  const html = renderLayoutHTML(plan, request);
  const layoutSVG = renderLayoutSVG(plan, request);
  const screenshotPath = await captureLayoutArtifact(html, plan, request.format ?? 'png');

  return {
    layoutSVG,
    iconGrid: plan.groups.flatMap((group) => group.icons),
    screenshotPath,
    metadata: plan,
  };
}

async function parseRequestBody(request: Request): Promise<Partial<BundleLayoutRequest>> {
  try {
    if (request.bodyUsed) {
      return {};
    }
    const clone = request.clone();
    const text = await clone.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch (error) {
    console.warn('[BundleBot] Failed to parse request body:', error);
    return {};
  }
}

export async function handleBundlebotLayout(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    let payload: Partial<BundleLayoutRequest> = {};

    const payloadParam = url.searchParams.get('payload');
    if (payloadParam) {
      try {
        payload = JSON.parse(payloadParam);
      } catch (error) {
        console.warn('[BundleBot] Unable to parse payload query parameter:', error);
      }
    }

    if (!payload.icons || payload.icons.length === 0) {
      const bodyPayload = await parseRequestBody(request);
      payload = { ...bodyPayload, ...payload };
    }

    const result = await generateBundleLayout(payload);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  } catch (error) {
    console.error('[BundleBot] Layout generation failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error generating layout.';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: {
        'content-type': 'application/json',
      },
    });
  }
}

export default handleBundlebotLayout;
