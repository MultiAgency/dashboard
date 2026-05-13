import { useEffect, useRef } from "react";

const PARTICLES = 220;
const TRAIL_FADE = 0.04;
const STEP_SIZE = 0.6;
const NOISE_SCALE = 0.012;
const FLOW_SPEED = 0.0008;

type Props = { className?: string };

function hash(x: number, y: number, z: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, z);
  const b = hash(xi + 1, yi, z);
  const c = hash(xi, yi + 1, z);
  const d = hash(xi + 1, yi + 1, z);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function FlowField({ className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const isDark = () => document.documentElement.classList.contains("dark");
    let bg = isDark() ? "#221E1A" : "#ECE5D5";
    let fg = isDark() ? "rgba(236,229,213,0.5)" : "rgba(45,40,35,0.55)";

    const themeObserver = new MutationObserver(() => {
      bg = isDark() ? "#221E1A" : "#ECE5D5";
      fg = isDark() ? "rgba(236,229,213,0.5)" : "rgba(45,40,35,0.55)";
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const particles = Array.from({ length: PARTICLES }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      life: Math.random() * 400,
    }));

    let rafId = 0;
    let t = 0;

    const tick = () => {
      t += FLOW_SPEED;
      ctx.fillStyle = `rgba(${isDark() ? "34,30,26" : "236,229,213"}, ${TRAIL_FADE})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = fg;

      for (const p of particles) {
        const angle = smoothNoise(p.x * NOISE_SCALE, p.y * NOISE_SCALE, t) * Math.PI * 4;
        p.x += Math.cos(angle) * STEP_SIZE;
        p.y += Math.sin(angle) * STEP_SIZE;
        p.life++;
        if (p.x < 0 || p.x > W || p.y < 0 || p.y > H || p.life > 500) {
          p.x = Math.random() * W;
          p.y = Math.random() * H;
          p.life = 0;
        }
        ctx.fillRect(p.x, p.y, 1, 1);
      }

      if (!reduce) rafId = requestAnimationFrame(tick);
    };

    if (reduce) {
      for (let i = 0; i < 60; i++) tick();
    } else {
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(rafId);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className ?? "absolute inset-0 pointer-events-none w-full h-full opacity-70"}
    />
  );
}
