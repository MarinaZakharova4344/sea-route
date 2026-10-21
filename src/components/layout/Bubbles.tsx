import type { CSSProperties } from "react";

/** Простая детерминированная «случайность»: разметка одинакова при каждой загрузке (без расхождений при гидратации). */
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Размеры: много мелких, меньше средних и несколько крупных. */
const SIZES = [6, 7, 8, 9, 10, 12, 14, 16, 18, 22, 26, 32, 40, 52];

const BUBBLES = Array.from({ length: 36 }, (_, i) => {
  const size = SIZES[Math.floor(Math.pow(rnd(i, 1), 1.35) * SIZES.length)];
  return {
    left: Math.round((i * 100) / 36 + (rnd(i, 2) - 0.5) * 2.6),
    size,
    dur: Math.round(56 + rnd(i, 3) * 52),
    delay: -Math.round(rnd(i, 4) * 110),
    sway: Math.round(6 + size / 3 + rnd(i, 5) * 8),
    o: Math.round((0.45 + rnd(i, 6) * 0.2) * 100) / 100,
  };
});

/** Медленно поднимающиеся пузырьки. Стили `.bubble` лежат в globals.css; контейнер задаёт страница. */
export default function Bubbles({ className }: { className: string }) {
  return (
    <div className={className} aria-hidden="true">
      {BUBBLES.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={
            {
              left: `${b.left}%`,
              "--size": `${b.size}px`,
              "--dur": `${b.dur}s`,
              "--delay": `${b.delay}s`,
              "--sway": `${b.sway}px`,
              "--o": b.o,
            } as CSSProperties
          }
        >
          <span className="bubble__body" />
        </span>
      ))}
    </div>
  );
}
