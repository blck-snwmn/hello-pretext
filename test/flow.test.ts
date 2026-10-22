import { afterAll, beforeAll, expect, test } from "bun:test";
import { basename } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { Circle, FlowedLine, FlowOptions } from "../src/flow";
import type {} from "./browser";

const options: FlowOptions = {
  width: 320,
  height: 4000,
  paddingX: 12,
  paddingY: 10,
  lineHeight: 24,
  font: "16px Arial, sans-serif",
  obstacleMargin: 8,
};

let browser: Browser;
let page: Page;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  const builds = await Promise.all([
    Bun.build({ entrypoints: ["./test/browser.ts"], target: "browser" }),
    Bun.build({
      entrypoints: ["./src/index.html"],
      target: "browser",
      define: { "process.env.NODE_ENV": '"production"' },
    }),
  ]);
  const assets = new Map<string, Blob>();
  for (const build of builds) {
    if (!build.success) throw new AggregateError(build.logs, "Browser test build failed");
    for (const output of build.outputs) assets.set(basename(output.path), output);
  }
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/") {
        return new Response('<script type="module" src="/browser.js"></script>', {
          headers: { "Content-Type": "text/html" },
        });
      }
      const asset = assets.get(path === "/demo/" ? "index.html" : basename(path));
      return asset ? new Response(asset) : new Response("Not found", { status: 404 });
    },
  });
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(server.url.href);
  await page.waitForFunction(() => Boolean(window.flowTest));
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop(true);
});

function visibleText(text: string): string {
  return text.replace(/\s/gu, "");
}

function render(text: string, circles: Circle[] = [], overrides: Partial<FlowOptions> = {}) {
  return page.evaluate(
    ({ text, circles, opts }) => window.flowTest.flowText(text, circles, opts),
    { text, circles, opts: { ...options, ...overrides } },
  );
}

test.each([
  ["English", "First comes the morning light. Then the small birds sing outside the window."],
  ["Japanese", "朝の光が窓から差し込みます。小さな鳥が歌い、静かな一日が始まります。"],
  ["graphemes", "Cafe\u0301 👨‍👩‍👧‍👦 👍🏽 🇯🇵 hello 世界。Cafe\u0301 👨‍👩‍👧‍👦 👍🏽 🇯🇵"],
  ["long words", "supercalifragilisticexpialidocious antidisestablishmentarianism abcdefghijklmnopqrstuvwxyz"],
])("%s matches the fixed-width layout oracle without losing text", async (_name, text) => {
  const graphemeEnds = new Set([0]);
  let offset = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(visibleText(text))) {
    offset += segment.length;
    graphemeEnds.add(offset);
  }
  for (const width of [40, 96, 250]) {
    const opts = { ...options, width: width + 2 * options.paddingX };
    const { flowed, expected } = await page.evaluate(({ text, opts, width }) => {
      const api = window.flowTest;
      return {
        flowed: api.flowText(text, [], opts),
        expected: api.layoutWithLines(api.prepareWithSegments(text, opts.font), width, opts.lineHeight).lines,
      };
    }, { text, opts, width });
    expect(flowed.map(({ text, width }) => ({ text, width }))).toEqual(
      expected.map(({ text, width }) => ({ text, width })),
    );
    expect(visibleText(flowed.map(line => line.text).join(""))).toBe(visibleText(text));
    let consumed = 0;
    for (const [index, line] of flowed.entries()) {
      consumed += visibleText(line.text).length;
      expect(graphemeEnds.has(consumed)).toBe(true);
      expect(line.x).toBe(opts.paddingX);
      expect(line.y).toBeCloseTo(opts.paddingY + (index + 0.78) * opts.lineHeight, 8);
      expect(line.width).toBeLessThanOrEqual(width + 0.01);
    }
  }
});

test("the v1 cursor advances through variable widths and ends with null", async () => {
  const text = "First Cafe\u0301 👨‍👩‍👧‍👦 日本語の文章 and supercalifragilisticexpialidocious finish.";
  const result = await page.evaluate(({ text, font }) => {
    const { prepareWithSegments, layoutNextLine } = window.flowTest;
    const prepared = prepareWithSegments(text, font);
    let cursor = { segmentIndex: 0, graphemeIndex: 0 };
    const steps = [];
    for (let index = 0; index <= text.length; index++) {
      const width = [40, 130, 75][index % 3]!;
      const line = layoutNextLine(prepared, width, cursor);
      if (line === null) {
        return { steps, ended: true, repeatedEnd: layoutNextLine(prepared, width, cursor) };
      }
      steps.push({ before: cursor, line });
      cursor = line.end;
    }
    return { steps, ended: false, repeatedEnd: undefined };
  }, { text, font: options.font });
  expect(result.ended).toBe(true);
  expect(result.repeatedEnd).toBeNull();
  expect(result.steps.length).toBeGreaterThan(1);
  for (const { before, line } of result.steps) {
    expect(
      line.end.segmentIndex > before.segmentIndex ||
      (line.end.segmentIndex === before.segmentIndex && line.end.graphemeIndex > before.graphemeIndex),
    ).toBe(true);
    expect(Number.isFinite(line.width)).toBe(true);
  }
  expect(visibleText(result.steps.map(({ line }) => line.text).join(""))).toBe(visibleText(text));
});

function expectClearOfCircles(lines: FlowedLine[], circles: Circle[], opts = options) {
  for (const line of lines) {
    const top = line.y - opts.lineHeight * 0.78;
    expect(line.x).toBeGreaterThanOrEqual(opts.paddingX);
    expect(line.x + line.width).toBeLessThanOrEqual(opts.width - opts.paddingX + 0.01);
    expect(top).toBeGreaterThanOrEqual(opts.paddingY - 0.01);
    expect(top + opts.lineHeight).toBeLessThanOrEqual(opts.height - opts.paddingY + 0.01);
    for (const circle of circles) {
      // Distance to the rendered line's rectangle checks the geometry without
      // repeating flowText's interval subtraction algorithm.
      const closestX = Math.max(line.x, Math.min(circle.cx, line.x + line.width));
      const closestY = Math.max(top, Math.min(circle.cy, top + opts.lineHeight));
      expect(Math.hypot(closestX - circle.cx, closestY - circle.cy)).toBeGreaterThanOrEqual(
        circle.r + opts.obstacleMargin - 0.01,
      );
    }
  }
}

const paragraph = "The morning light reaches the window. 小さな鳥が歌っています。Cafe\u0301 and a longwordwithoutspaces follow. ".repeat(8);

test("text uses both sides of a circle on the same row without overlaps or omissions", async () => {
  const circles = [{ id: "middle", cx: 160, cy: 70, r: 48 }];
  const lines = await render(paragraph, circles);
  expect(visibleText(lines.map(line => line.text).join(""))).toBe(visibleText(paragraph));
  expectClearOfCircles(lines, circles);
  expect(lines.some((line, index) => {
    const next = lines[index + 1];
    return next !== undefined && next.y === line.y && line.x < 160 && next.x > 160;
  })).toBe(true);
});

test("overlapping circles form one obstacle regardless of their order", async () => {
  const circles = [
    { id: "left", cx: 130, cy: 70, r: 50 },
    { id: "right", cx: 195, cy: 70, r: 50 },
  ];
  const lines = await render(paragraph, circles);
  expect(lines).toEqual(await render(paragraph, circles.toReversed()));
  expect(visibleText(lines.map(line => line.text).join(""))).toBe(visibleText(paragraph));
  expectClearOfCircles(lines, circles);
});

test("a fully blocked band delays text and resumes without consuming it", async () => {
  const circles = [{ id: "wall", cx: 160, cy: 35, r: 200 }];
  const text = "Every word must survive the blocked rows. 全部の文字を表示します。";
  const lines = await render(text, circles);
  expect(lines.length).toBeGreaterThan(0);
  expect(lines[0]!.y).toBeGreaterThan(options.paddingY + options.lineHeight * 0.78);
  expect(visibleText(lines.map(line => line.text).join(""))).toBe(visibleText(text));
  expectClearOfCircles(lines, circles);
});

test("runs narrower than 40px are skipped while exactly 40px is usable", async () => {
  const text = "Narrow text 日本語";
  expect(await render(text, [], { width: options.paddingX * 2 + 39 })).toEqual([]);
  const lines = await render(text, [], { width: options.paddingX * 2 + 40 });
  expect(lines.length).toBeGreaterThan(0);
  expect(visibleText(lines.map(line => line.text).join(""))).toBe(visibleText(text));

  // At the first band the circle leaves only 39px on each side. Text must
  // start later, when at least one free run has reached the existing minimum.
  const circles = [{ id: "narrow-gaps", cx: 160, cy: 22, r: 101 }];
  const aroundCircle = await render(text, circles);
  expect(aroundCircle[0]!.y).toBeGreaterThan(options.paddingY + options.lineHeight * 0.78);
  expect(visibleText(aroundCircle.map(line => line.text).join(""))).toBe(visibleText(text));
  expectClearOfCircles(aroundCircle, circles);
});

test("cached preparation follows text and font changes and permits new geometry", async () => {
  const firstText = "Small words in the first paragraph.";
  const secondText = "A changed paragraph has different text. 別の文章です。";
  const cases = [
    { text: firstText, font: options.font },
    { text: secondText, font: options.font },
    { text: secondText, font: "24px monospace" },
    { text: firstText, font: options.font },
  ];
  const results: FlowedLine[][] = [];
  for (const { text, font } of cases) {
    const lines = await render(text, [], { font });
    const expected = await page.evaluate(({ text, font, opts }) => {
      const api = window.flowTest;
      return api.layoutWithLines(api.prepareWithSegments(text, font), opts.width - 2 * opts.paddingX, opts.lineHeight).lines;
    }, { text, font, opts: options });
    expect(lines.map(({ text, width }) => ({ text, width }))).toEqual(
      expected.map(({ text, width }) => ({ text, width })),
    );
    results.push(lines);
  }
  expect(results[0]).toEqual(results[3]);
  expect(results[1]).not.toEqual(results[2]);
  const circles = [{ id: "moved", cx: 160, cy: 30, r: 45 }];
  const moved = await render(firstText, circles);
  expect(moved).not.toEqual(results[0]);
  expect(visibleText(moved.map(line => line.text).join(""))).toBe(visibleText(firstText));
  expectClearOfCircles(moved, circles);
});

test("height clipping retains only complete rows and exhausted text adds no rows", async () => {
  const full = await render(paragraph);
  const twoRows = 2 * options.paddingY + 2 * options.lineHeight;
  expect(await render(paragraph, [], { height: twoRows })).toEqual(full.slice(0, 2));
  expect(await render(paragraph, [], { height: twoRows - 1 })).toEqual(full.slice(0, 1));
  expect(await render(paragraph, [], { height: 2 * options.paddingY + options.lineHeight - 1 })).toEqual([]);
  expect(await render("")).toEqual([]);
  expect(await render("   \t\n")).toEqual([]);
  const short = await render("Done.");
  expect(short).toHaveLength(1);
  expect(short[0]!.text).toBe("Done.");
});

test("the React demo renders text and continues moving circles and reflowing", async () => {
  const demo = await browser.newPage();
  const errors: string[] = [];
  demo.on("pageerror", error => errors.push(error.message));
  try {
    await demo.goto(new URL("demo/", server.url).href);
    await demo.waitForFunction(() => document.querySelectorAll("svg text").length > 10);
    const initial = await demo.evaluate(() => ({
      circles: Array.from(document.querySelectorAll("svg circle"), circle => Number(circle.getAttribute("cx"))),
      text: Array.from(document.querySelectorAll("svg text"), line => line.textContent).join(""),
      positions: Array.from(document.querySelectorAll("svg text"), line => line.getAttribute("x")),
    }));
    expect(initial.circles).toHaveLength(4);
    expect(initial.text.startsWith("The cold had teeth today")).toBe(true);
    await demo.waitForFunction(initial => {
      const circles = Array.from(document.querySelectorAll("svg circle"));
      const positions = Array.from(document.querySelectorAll("svg text"), line => line.getAttribute("x"));
      return circles.some((circle, index) => Math.abs(Number(circle.getAttribute("cx")) - initial.circles[index]!) > 1)
        && JSON.stringify(positions) !== JSON.stringify(initial.positions);
    }, initial);
    expect(errors).toEqual([]);
  } finally {
    await demo.close();
  }
}, 15_000);
