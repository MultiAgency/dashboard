import { useEffect, useRef } from "react";

const W = 160;
const H = 100;
const STATES = 12;
const THRESHOLD = 1;
const STEPS_PER_FRAME = 1;

type Props = { className?: string };

export function CyclicCAField({ className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    canvas.width = W;
    canvas.height = H;
    const N = W * H;

    let cells = new Uint8Array(N);
    let next = new Uint8Array(N);
    for (let i = 0; i < N; i++) cells[i] = Math.floor(Math.random() * STATES);

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

    const step = () => {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const v = cells[i];
          const succ = (v + 1) % STATES;
          let count = 0;
          if (x > 0 && cells[i - 1] === succ) count++;
          if (x < W - 1 && cells[i + 1] === succ) count++;
          if (y > 0 && cells[i - W] === succ) count++;
          if (y < H - 1 && cells[i + W] === succ) count++;
          next[i] = count >= THRESHOLD ? succ : v;
        }
      }
      [cells, next] = [next, cells];
    };

    const render = () => {
      const data = img.data;
      const [bgR, bgG, bgB] = bg;
      const [fgR, fgG, fgB] = fg;
      for (let i = 0; i < N; i++) {
        const t = cells[i] / (STATES - 1);
        const idx = i * 4;
        data[idx] = bgR + (fgR - bgR) * t;
        data[idx + 1] = bgG + (fgG - bgG) * t;
        data[idx + 2] = bgB + (fgB - bgB) * t;
        data[idx + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };

    let rafId = 0;
    let frame = 0;
    const tick = () => {
      frame++;
      if (frame % 3 === 0) {
        for (let s = 0; s < STEPS_PER_FRAME; s++) step();
      }
      render();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

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
