import { useMemo, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

interface CompletionCelebrationProps {
  burstId: number;
  x: number;
  y: number;
}

type ParticleStyle = CSSProperties & Record<`--${string}`, string>;

const COLORS = [
  "#2d5a3d",
  "#5a8f69",
  "#a8c5a5",
  "#d6b86a",
  "#b96d4f",
  "#efe1a8",
];

export function CompletionCelebration({
  burstId,
  x,
  y,
}: CompletionCelebrationProps) {
  const reducedMotion = usePrefersReducedMotion();
  const particles = useMemo(() => {
    const seedOffset = burstId % 17;
    return Array.from({ length: 28 }, (_, index) => {
      const angle =
        ((index + 0.5) / 28) * Math.PI * 2 +
        ((index * 7 + seedOffset) % 11 - 5) * 0.026;
      const distance = 74 + ((index * 37 + seedOffset * 13) % 92);
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance * 0.76 - 18;
      const width = 5 + ((index * 3 + seedOffset) % 5);
      const height = index % 4 === 0 ? width : 9 + (index % 7);
      const style: ParticleStyle = {
        "--confetti-x": `${dx.toFixed(1)}px`,
        "--confetti-y": `${dy.toFixed(1)}px`,
        "--confetti-rotation": `${120 + ((index * 53) % 420)}deg`,
        "--confetti-delay": `${(index % 6) * 8}ms`,
        "--confetti-color": COLORS[index % COLORS.length] ?? COLORS[0]!,
        "--confetti-width": `${width}px`,
        "--confetti-height": `${height}px`,
      };
      return style;
    });
  }, [burstId]);

  if (reducedMotion) return null;

  return (
    <div
      className="completion-celebration"
      style={{ left: x, top: y }}
      aria-hidden="true"
    >
      {particles.map((style, index) => (
        <span
          className="completion-confetti"
          style={style}
          key={`${burstId}-${index}`}
        />
      ))}
    </div>
  );
}
