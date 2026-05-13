import { useEffect, useRef } from "react";

const W = 200;
const H = 130;
const STEPS_PER_FRAME = 6;

export const RD_PRESETS = {
  worms: { du: 0.16, dv: 0.08, f: 0.06, k: 0.062 },
  solitons: { du: 0.16, dv: 0.08, f: 0.0367, k: 0.0649 },
  mitosis: { du: 0.16, dv: 0.08, f: 0.014, k: 0.054 },
  spots: { du: 0.16, dv: 0.08, f: 0.062, k: 0.0609 },
  coral: { du: 0.16, dv: 0.08, f: 0.039, k: 0.058 },
  waves: { du: 0.16, dv: 0.08, f: 0.026, k: 0.051 },
  bacteria: { du: 0.16, dv: 0.08, f: 0.078, k: 0.061 },
} as const;

export type RdPreset = keyof typeof RD_PRESETS;

type Props = { preset?: RdPreset; className?: string };

export function ReactionDiffusionField({ preset = "worms", className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { du: DU, dv: DV, f: F, k: K } = RD_PRESETS[preset];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    canvas.width = W;
    canvas.height = H;
    const N = W * H;

    let u = new Float32Array(N).fill(1);
    let v = new Float32Array(N).fill(0);
    let un = new Float32Array(N).fill(1);
    let vn = new Float32Array(N).fill(0);

    for (let s = 0; s < 14; s++) {
      const cx = 20 + Math.floor(Math.random() * (W - 40));
      const cy = 20 + Math.floor(Math.random() * (H - 40));
      const r = 4 + Math.floor(Math.random() * 4);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < W && y >= 0 && y < H) {
            u[y * W + x] = 0.25 + Math.random() * 0.1;
            v[y * W + x] = 0.5 + Math.random() * 0.1;
          }
        }
      }
    }

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
      for (let y = 1; y < H - 1; y++) {
        const row = y * W;
        for (let x = 1; x < W - 1; x++) {
          const i = row + x;
          const lu = u[i - 1] + u[i + 1] + u[i - W] + u[i + W] - 4 * u[i];
          const lv = v[i - 1] + v[i + 1] + v[i - W] + v[i + W] - 4 * v[i];
          const uvv = u[i] * v[i] * v[i];
          un[i] = u[i] + DU * lu - uvv + F * (1 - u[i]);
          vn[i] = v[i] + DV * lv + uvv - (F + K) * v[i];
        }
      }
      for (let x = 0; x < W; x++) {
        un[x] = u[x];
        vn[x] = v[x];
        un[(H - 1) * W + x] = u[(H - 1) * W + x];
        vn[(H - 1) * W + x] = v[(H - 1) * W + x];
      }
      for (let y = 0; y < H; y++) {
        un[y * W] = u[y * W];
        vn[y * W] = v[y * W];
        un[y * W + W - 1] = u[y * W + W - 1];
        vn[y * W + W - 1] = v[y * W + W - 1];
      }
      [u, un] = [un, u];
      [v, vn] = [vn, v];
    };

    const render = () => {
      const data = img.data;
      const [bgR, bgG, bgB] = bg;
      const [fgR, fgG, fgB] = fg;
      for (let i = 0; i < N; i++) {
        const vi = Math.min(1, Math.max(0, v[i] * 1.2));
        const idx = i * 4;
        data[idx] = bgR + (fgR - bgR) * vi;
        data[idx + 1] = bgG + (fgG - bgG) * vi;
        data[idx + 2] = bgB + (fgB - bgB) * vi;
        data[idx + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };

    let rafId = 0;
    const tick = () => {
      for (let s = 0; s < STEPS_PER_FRAME; s++) step();
      render();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      themeObserver.disconnect();
    };
  }, [DU, DV, F, K]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className ?? "absolute inset-0 pointer-events-none w-full h-full opacity-55"}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
