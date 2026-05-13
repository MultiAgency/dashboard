import { useEffect, useRef } from "react";

const W = 200;
const H = 130;
const SEED_COUNT = 28;
const DRIFT = 0.18;

type Props = { className?: string };

export function WorleyField({ className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    canvas.width = W;
    canvas.height = H;

    const seeds = Array.from({ length: SEED_COUNT }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * DRIFT,
      vy: (Math.random() - 0.5) * DRIFT,
    }));

    const LIGHT_BG: [number, number, number] = [236, 229, 213];
    const LIGHT_FG: [number, number, number] = [45, 40, 35];
    const DARK_BG: [number, number, number] = [34, 30, 26];
    const DARK_FG: [number, number, number] = [236, 229, 213];
    const isDark = () => document.documentElement.classList.contains("dark");
    let bg = isDark() ? DARK_BG : LIGHT_BG;
    let fg = isDark() ? DARK_FG : LIGHT_FG;

    const themeObserver = new MutationObserver(() => {
      bg = isDark() ? DARK_BG : LIGHT_BG;
      fg = isDark() ? DARK_FG : LIGHT_FG;
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const img = ctx.createImageData(W, H);

    const render = () => {
      const data = img.data;
      const [bgR, bgG, bgB] = bg;
      const [fgR, fgG, fgB] = fg;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let d1 = Infinity;
          let d2 = Infinity;
          for (let i = 0; i < seeds.length; i++) {
            const dx = x - seeds[i].x;
            const dy = y - seeds[i].y;
            const d = dx * dx + dy * dy;
            if (d < d1) {
              d2 = d1;
              d1 = d;
            } else if (d < d2) {
              d2 = d;
            }
          }
          const edge = Math.sqrt(d2) - Math.sqrt(d1);
          const t = Math.min(1, edge / 4);
          const idx = (y * W + x) * 4;
          data[idx] = bgR + (fgR - bgR) * (1 - t);
          data[idx + 1] = bgG + (fgG - bgG) * (1 - t);
          data[idx + 2] = bgB + (fgB - bgB) * (1 - t);
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    let rafId = 0;
    const tick = () => {
      if (!reduce) {
        for (const s of seeds) {
          s.x += s.vx;
          s.y += s.vy;
          if (s.x < 0 || s.x > W) s.vx *= -1;
          if (s.y < 0 || s.y > H) s.vy *= -1;
        }
      }
      render();
      if (!reduce) rafId = requestAnimationFrame(tick);
    };
    if (reduce) render();
    else rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className ?? "absolute inset-0 pointer-events-none w-full h-full opacity-55"}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
