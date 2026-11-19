import { useEffect, useRef } from "react";

const DOT_CELL = 14;
const DOT_LEVELS = 6;
const FIELD_SPEED = 0.00018;
const RIDGE_AT = 0.9;
const RIDGE_WIDTH = 0.035;

function hash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function flowField(x: number, y: number, t: number): number {
  const warpX = smoothNoise(x * 0.6 + t * 0.7, y * 0.6 - t * 0.4);
  const warpY = smoothNoise(x * 0.6 - t * 0.5 + 5.2, y * 0.6 + t * 0.6 + 1.3);
  const base = smoothNoise(x + warpX * 1.6 + t, y + warpY * 1.6 - t * 0.6);
  const detail = smoothNoise(x * 2.1 - t * 1.3, y * 2.1 + t * 0.9);
  return base * 0.75 + detail * 0.25;
}

export function DiffusionField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    const readToken = (varName: string): string => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (!probeCtx || !raw) return "rgb(0 0 0)";
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.fillStyle = raw;
      probeCtx.fillRect(0, 0, 1, 1);
      const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r} ${g} ${b})`;
    };
    let dotColor = readToken("--muted-foreground");
    let peakColor = readToken("--primary");

    let dpr = 1;
    let cols = 0;
    let rows = 0;
    let cell = DOT_CELL;
    let mask = new Float32Array(0);
    const pointer = { x: -1, y: -1, strength: 0, target: 0 };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      cell = DOT_CELL * dpr;
      cols = Math.ceil(canvas.width / cell);
      rows = Math.ceil(canvas.height / cell);
      mask = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const nx = c / Math.max(1, cols - 1);
          const ny = r / Math.max(1, rows - 1);
          const textFade = 0.55 + 0.45 * Math.min(1, Math.max(0, (nx - 0.18) / 0.5));
          const edgeX = Math.min(nx, 1 - nx) / 0.05;
          const edgeY = Math.min(ny, 1 - ny) / 0.1;
          const edge = Math.min(1, edgeX, edgeY);
          mask[r * cols + c] = textFade * edge * edge * (3 - 2 * edge);
        }
      }
      if (!running) render(performance.now());
    };

    const buckets: number[][] = Array.from({ length: DOT_LEVELS }, () => []);
    const ridges: number[] = [];
    const render = (now: number) => {
      const t = motion.matches ? 12 : now * FIELD_SPEED;
      pointer.strength += (pointer.target - pointer.strength) * 0.08;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const bucket of buckets) bucket.length = 0;
      ridges.length = 0;
      const radius = 9;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const m = mask[r * cols + c]!;
          if (m <= 0.01) continue;
          let value = flowField(c * 0.085, r * 0.11, t);
          value = Math.min(1.2, Math.max(0, (value - 0.34) / 0.42));
          if (pointer.strength > 0.01) {
            const dx = c - pointer.x;
            const dy = r - pointer.y;
            const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / radius);
            value += falloff * falloff * 0.55 * pointer.strength;
          }
          const vm = value * m;
          if (Math.abs(vm - RIDGE_AT) < RIDGE_WIDTH) {
            ridges.push(c, r);
            continue;
          }
          const level = Math.floor(Math.min(0.999, vm * 0.84) * DOT_LEVELS);
          if (level > 0) buckets[level]!.push(c, r);
        }
      }
      ctx.fillStyle = dotColor;
      for (let level = 1; level < DOT_LEVELS; level++) {
        const bucket = buckets[level]!;
        if (bucket.length === 0) continue;
        const size = Math.max(dpr, cell * (0.14 + 0.46 * (level / (DOT_LEVELS - 1))));
        const offset = (cell - size) / 2;
        ctx.globalAlpha = 0.1 + 0.12 * level;
        for (let i = 0; i < bucket.length; i += 2) {
          ctx.fillRect(bucket[i]! * cell + offset, bucket[i + 1]! * cell + offset, size, size);
        }
      }
      if (ridges.length > 0) {
        const size = cell * 0.5;
        const offset = (cell - size) / 2;
        ctx.fillStyle = peakColor;
        ctx.globalAlpha = 0.95;
        for (let i = 0; i < ridges.length; i += 2) {
          ctx.fillRect(ridges[i]! * cell + offset, ridges[i + 1]! * cell + offset, size, size);
        }
      }
      ctx.globalAlpha = 1;
    };

    const themeObserver = new MutationObserver(() => {
      dotColor = readToken("--muted-foreground");
      peakColor = readToken("--primary");
      if (!running) render(performance.now());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });

    const host = document.documentElement;
    const onPointerMove = (event: PointerEvent) => {
      if (motion.matches) return;
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) * dpr) / cell;
      pointer.y = ((event.clientY - rect.top) * dpr) / cell;
      pointer.target = 1;
    };
    const onPointerLeave = () => {
      pointer.target = 0;
    };

    let running = false;
    let visible = true;
    let rafId = 0;
    let lastFrame = 0;
    const tick = (now: number) => {
      if (now - lastFrame >= 1000 / 30) {
        render(now);
        lastFrame = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    const sync = () => {
      const shouldRun = !motion.matches && visible && document.visibilityState === "visible";
      if (motion.matches) {
        pointer.strength = pointer.target = 0;
        render(0);
      }
      if (shouldRun && !running) {
        running = true;
        rafId = requestAnimationFrame(tick);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(rafId);
      }
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      sync();
    });
    intersectionObserver.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    host.addEventListener("pointerleave", onPointerLeave);
    motion.addEventListener("change", sync);
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      motion.removeEventListener("change", sync);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return (
    <div aria-hidden="true" className="ma-field">
      <canvas ref={canvasRef} />
    </div>
  );
}
