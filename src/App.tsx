import { useMemo, useRef, useState } from "react";
import { flowText, type Circle, type FlowOptions } from "./flow";
import "./index.css";

const FONT = "16px Helvetica, Arial, sans-serif";

const OPTIONS: FlowOptions = {
  width: 720,
  height: 1000,
  paddingX: 24,
  paddingY: 24,
  lineHeight: 24,
  font: FONT,
  obstacleMargin: 10,
};

const SAMPLE_TEXT = `The cold had teeth today, the kind that finds the seam between wool and skin no matter how carefully you dress for it. I wore gloves, thick ones, lined with something soft on the inside, and even so my fingertips went stiff at the third intersection. I had stopped walking quickly because I no longer needed to be anywhere in particular. The train would come when it came. The wait would be the wait. The warning bell had already started its sharp metallic clang as I arrived, the two red lamps flashing in alternation above the crossing, and the yellow-and-black striped gates were just finishing their slow descent. I stopped behind the yellow stop line and watched them settle into place. Behind me a delivery cyclist coasted to a halt and exhaled into his scarf. Across the rails, on the opposite side of the road, a woman and a small child stood in matching attitudes of patience, their breath rising together in twin plumes. The child was perhaps four, holding the corner of his mother's coat with the seriousness reserved for small children waiting for important things. I looked up because there was nothing else to look at. The sky surprised me. Not in a loud way, since the sun had already gone behind the rooftops, but in the way the cold had thinned the air and left the light layered cleanly: a band of muted orange near the horizon, lavender above that, and then a grey-blue that was almost black at the very top of the sky. A single streak of cloud held all three colors at once, like someone had wiped a finger across wet paint. The train came. It was the local, four cars long, mostly empty windows and the occasional outline of someone bent over a phone. It rushed past with that heavy, hurried rumble commuter trains have, and the rails kept faintly singing for a moment after it was gone. The bell clanged a few more times and then cut off, and the striped gates began to lift with their slow mechanical politeness. The mother and the child started across before I did. The child broke into a small run halfway over and the mother caught up, and then they were holding hands again, properly this time, the child swinging the joined hands the way children do when they have rejoined someone they love. They passed me without looking up. I passed them without speaking. We were just three pieces of the evening returning to their separate places. I walked the last three blocks with my hands in my pockets, gloves and all, watching the orange band darken to rust. The streetlights came on one by one, hesitant and orange themselves, and the air smelled faintly of kerosene from somebody's heater. My key turned in the door the way it has turned a thousand times before. The dog heard me first. He always hears me first. He came around the corner of the hallway with the dignity of a doorman and then forgot to be dignified and skidded the last short meter on the wood floor, his tail already declaring that the day was now improved. A second later my wife appeared behind him, drying her hands on a towel, her hair tied up in the loose way she ties it when she has been cooking. She said something like "you're cold," not as a question, and put her hands briefly on my cheeks, and her hands were warm, and the cold went out of me in one slow exhale. There was nothing remarkable about the day. I want to remember it anyway.`;

const PALETTE = ["#ff6b6b", "#4ecdc4", "#ffe66d"];

export function App() {
  const [circles, setCircles] = useState<Circle[]>([
    { id: "a", cx: 140, cy: 150, r: 72 },
    { id: "b", cx: 580, cy: 280, r: 56 },
  ]);
  const draggingRef = useRef<{ id: string; dx: number; dy: number } | null>(
    null,
  );
  const svgRef = useRef<SVGSVGElement | null>(null);

  const lines = useMemo(
    () => flowText(SAMPLE_TEXT, circles, OPTIONS),
    [circles],
  );

  function svgPoint(e: React.PointerEvent): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const scaleX = OPTIONS.width / rect.width;
    const scaleY = OPTIONS.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(id: string) {
    return (e: React.PointerEvent<SVGCircleElement>) => {
      const p = svgPoint(e);
      const c = circles.find(c => c.id === id);
      if (!p || !c) return;
      draggingRef.current = { id, dx: c.cx - p.x, dy: c.cy - p.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    };
  }

  function onPointerMove(e: React.PointerEvent<SVGCircleElement>) {
    const drag = draggingRef.current;
    const p = svgPoint(e);
    if (!drag || !p) return;
    setCircles(prev =>
      prev.map(c =>
        c.id === drag.id ? { ...c, cx: p.x + drag.dx, cy: p.y + drag.dy } : c,
      ),
    );
  }

  function onPointerUp() {
    draggingRef.current = null;
  }

  return (
    <div className="app">
      <header>
        <h1>pretext × 円形回り込み</h1>
        <p className="hint">
          円をドラッグするとテキストの回り込みがリアルタイムに再計算されます。
        </p>
      </header>
      <div className="stage">
        <svg
          ref={svgRef}
          className="canvas"
          viewBox={`0 0 ${OPTIONS.width} ${OPTIONS.height}`}
          width={OPTIONS.width}
          height={OPTIONS.height}
        >
          <rect
            x={0}
            y={0}
            width={OPTIONS.width}
            height={OPTIONS.height}
            className="bg"
          />
          {lines.map((l, i) => (
            <text key={i} x={l.x} y={l.y} className="line">
              {l.text}
            </text>
          ))}
          {circles.map((c, i) => (
            <circle
              key={c.id}
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              fill={PALETTE[i % PALETTE.length]}
              className="obstacle"
              onPointerDown={onPointerDown(c.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          ))}
        </svg>
      </div>
      <footer className="meta">
        lines: {lines.length} · circles: {circles.length}
      </footer>
    </div>
  );
}

export default App;
