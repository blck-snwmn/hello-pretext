import {
  prepareWithSegments,
  layoutNextLine,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";

export type Circle = { id: string; cx: number; cy: number; r: number };

export type FlowedLine = {
  text: string;
  x: number;
  y: number;
  width: number;
};

export type FlowOptions = {
  width: number;
  height: number;
  paddingX: number;
  paddingY: number;
  lineHeight: number;
  font: string;
  obstacleMargin: number;
};

type Interval = [number, number];

function circleIntervalAtBand(
  c: Circle,
  bandTop: number,
  bandBottom: number,
  margin: number,
): Interval | null {
  const effectiveR = c.r + margin;
  const dy =
    c.cy < bandTop ? bandTop - c.cy : c.cy > bandBottom ? c.cy - bandBottom : 0;
  if (dy >= effectiveR) return null;
  const dx = Math.sqrt(effectiveR * effectiveR - dy * dy);
  return [c.cx - dx, c.cx + dx];
}

function freeRuns(
  forbidden: Interval[],
  columnLeft: number,
  columnRight: number,
): Interval[] {
  const merged: Interval[] = [];
  forbidden
    .slice()
    .sort((a, b) => a[0] - b[0])
    .forEach(([l, r]) => {
      const last = merged[merged.length - 1];
      if (last && last[1] >= l) last[1] = Math.max(last[1], r);
      else merged.push([l, r]);
    });

  const runs: Interval[] = [];
  let prev = columnLeft;
  for (const [l, r] of merged) {
    if (l > prev) runs.push([prev, Math.min(l, columnRight)]);
    prev = Math.max(prev, r);
    if (prev >= columnRight) break;
  }
  if (prev < columnRight) runs.push([prev, columnRight]);
  return runs;
}

const MIN_RUN_WIDTH = 40;

let cachedKey = "";
let cachedPrepared: PreparedTextWithSegments | null = null;

function getPrepared(text: string, font: string): PreparedTextWithSegments {
  const key = `${font} ${text}`;
  if (key !== cachedKey || !cachedPrepared) {
    cachedPrepared = prepareWithSegments(text, font);
    cachedKey = key;
  }
  return cachedPrepared;
}

export function flowText(
  text: string,
  circles: Circle[],
  opts: FlowOptions,
): FlowedLine[] {
  const prepared = getPrepared(text, opts.font);
  const columnLeft = opts.paddingX;
  const columnRight = opts.width - opts.paddingX;
  const bottom = opts.height - opts.paddingY;

  const out: FlowedLine[] = [];
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
  let y = opts.paddingY;
  // Hard cap on the outer loop: defensive against a future change where the
  // exit conditions stop firing (e.g. y not advancing or `exhausted` never set).
  let safety = 0;

  let exhausted = false;
  while (!exhausted && y + opts.lineHeight <= bottom) {
    const forbidden: Interval[] = [];
    for (const c of circles) {
      const iv = circleIntervalAtBand(
        c,
        y,
        y + opts.lineHeight,
        opts.obstacleMargin,
      );
      if (iv) forbidden.push(iv);
    }
    const runs = freeRuns(forbidden, columnLeft, columnRight);

    for (const [runL, runR] of runs) {
      const runWidth = runR - runL;
      if (runWidth < MIN_RUN_WIDTH) continue;

      const line = layoutNextLine(prepared, cursor, runWidth);
      if (line === null) {
        exhausted = true;
        break;
      }
      // Skip if pretext returned a line but didn't consume any text. The simple
      // line walk always advances at least one grapheme/segment, but the chunk
      // path (BiDi, rich-text, or future prepare options) has degenerate cases
      // that can return zero-progress. Without this we'd push an empty line and
      // re-query the same cursor on the next run, wasting work.
      const advanced =
        line.end.segmentIndex !== cursor.segmentIndex ||
        line.end.graphemeIndex !== cursor.graphemeIndex;
      if (!advanced) continue;

      out.push({
        text: line.text,
        x: runL,
        y: y + opts.lineHeight * 0.78,
        width: line.width,
      });
      cursor = line.end;
    }

    y += opts.lineHeight;
    if (++safety > 10000) break;
  }

  return out;
}
