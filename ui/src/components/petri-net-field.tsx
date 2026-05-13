import { useEffect, useRef, useState } from "react";

const VB_W = 1600;
const VB_H = 1000;
const PLACE_R = 36;
const TOKEN_R = 5;
const TRANSITION_HALF_W = 9;
const STRIPE_H = 12;
const STRIPE_GAP = 4;
const PHASE_MS = 550;
const FIRE_INTERVAL_MS = 1700;

const diamondPoints = (cx: number, cy: number, r: number) =>
  `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;

type Place = { id: string; x: number; y: number; label: string };
type Transition = {
  id: string;
  x: number;
  y: number;
  h: number;
  label: string;
  in: string[];
  out: string[];
};

const PLACES: Place[] = [
  { id: "p1", x: 200, y: 280, label: "p₁" },
  { id: "p2", x: 700, y: 280, label: "p₂" },
  { id: "p3", x: 200, y: 500, label: "p₃" },
  { id: "p4", x: 700, y: 500, label: "p₄" },
  { id: "p5", x: 200, y: 720, label: "p₅" },
  { id: "p6", x: 700, y: 720, label: "p₆" },
];

const TRANSITIONS: Transition[] = [
  { id: "t1", x: 450, y: 280, h: 56, label: "t₁", in: ["p1"], out: ["p2"] },
  { id: "t3", x: 450, y: 500, h: 56, label: "t₃", in: ["p3"], out: ["p4"] },
  { id: "t5", x: 450, y: 720, h: 56, label: "t₅", in: ["p5"], out: ["p6"] },
  {
    id: "tS",
    x: 1100,
    y: 500,
    h: 520,
    label: "t_sync",
    in: ["p2", "p4", "p6"],
    out: ["p1", "p3", "p5"],
  },
];

const INITIAL_TOKENS: Record<string, number> = {
  p1: 1,
  p2: 0,
  p3: 1,
  p4: 0,
  p5: 1,
  p6: 0,
};

type Flight = {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

const placeById = (id: string) => PLACES.find((p) => p.id === id);

function FlyingToken({ flight }: { flight: Flight }) {
  const [pos, setPos] = useState({ x: flight.fromX, y: flight.fromY });
  useEffect(() => {
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => setPos({ x: flight.toX, y: flight.toY }));
      return () => cancelAnimationFrame(r2);
    });
    return () => cancelAnimationFrame(r1);
  }, [flight.toX, flight.toY]);
  return (
    <polygon
      points={diamondPoints(0, 0, TOKEN_R + 1)}
      fill="var(--accent)"
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        transition: `transform ${PHASE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
      }}
    />
  );
}

export function PetriNetField() {
  const tokensRef = useRef<Record<string, number>>({ ...INITIAL_TOKENS });
  const [, setTick] = useState(0);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pulsing, setPulsing] = useState<Set<string>>(new Set());
  const forceRender = () => setTick((n) => n + 1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    const cleanups: ReturnType<typeof setTimeout>[] = [];

    const schedule = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
      cleanups.push(t);
    };

    const fire = (t: Transition) => {
      for (const p of t.in) {
        tokensRef.current[p] = Math.max(0, (tokensRef.current[p] ?? 0) - 1);
      }
      forceRender();

      const phaseA: Flight[] = t.in
        .map((pid) => {
          const place = placeById(pid);
          if (!place) return null;
          return {
            id: `${t.id}-${pid}-A-${Math.random().toString(36).slice(2)}`,
            fromX: place.x,
            fromY: place.y,
            toX: t.x,
            toY: t.y,
          };
        })
        .filter((f): f is Flight => f !== null);
      setFlights((prev) => [...prev, ...phaseA]);

      schedule(() => {
        setPulsing((prev) => new Set(prev).add(t.id));
        schedule(() => {
          setPulsing((prev) => {
            const next = new Set(prev);
            next.delete(t.id);
            return next;
          });
        }, 240);

        setFlights((prev) => prev.filter((f) => !phaseA.some((p) => p.id === f.id)));

        const phaseB: Flight[] = t.out
          .map((pid) => {
            const place = placeById(pid);
            if (!place) return null;
            return {
              id: `${t.id}-${pid}-B-${Math.random().toString(36).slice(2)}`,
              fromX: t.x,
              fromY: t.y,
              toX: place.x,
              toY: place.y,
            };
          })
          .filter((f): f is Flight => f !== null);
        setFlights((prev) => [...prev, ...phaseB]);

        schedule(() => {
          setFlights((prev) => prev.filter((f) => !phaseB.some((p) => p.id === f.id)));
          for (const p of t.out) {
            tokensRef.current[p] = (tokensRef.current[p] ?? 0) + 1;
          }
          forceRender();
        }, PHASE_MS);
      }, PHASE_MS);
    };

    const stepInterval = setInterval(() => {
      const enabled = TRANSITIONS.filter((t) => t.in.every((p) => (tokensRef.current[p] ?? 0) > 0));
      if (enabled.length === 0) return;
      const pick = enabled[Math.floor(Math.random() * enabled.length)];
      if (pick) fire(pick);
    }, FIRE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(stepInterval);
      for (const c of cleanups) clearTimeout(c);
    };
  }, []);

  const tokens = tokensRef.current;

  return (
    <svg
      role="presentation"
      aria-hidden
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      className="block w-full h-full pointer-events-none"
    >
      <title>Petri net field</title>
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 14 12"
          refX="13"
          refY="6"
          markerWidth="7"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 14 6 L 0 12 L 4 6 z" fill="currentColor" />
        </marker>
      </defs>

      <g stroke="currentColor" strokeOpacity="0.42" fill="none">
        {TRANSITIONS.flatMap((t) =>
          t.in.map((pid) => {
            const p = placeById(pid);
            if (!p) return null;
            return (
              <line
                key={`in-${t.id}-${pid}`}
                x1={p.x + PLACE_R}
                y1={p.y}
                x2={t.x - TRANSITION_HALF_W}
                y2={t.y}
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
            );
          }),
        )}
        {TRANSITIONS.flatMap((t) =>
          t.out.map((pid) => {
            const p = placeById(pid);
            if (!p) return null;
            const isReturn = t.id === "tS";
            if (isReturn) {
              const dx = p.x - t.x;
              const cx1 = t.x + dx * 0.2;
              const cy1 = t.y - 280;
              const cx2 = p.x - dx * 0.2;
              const cy2 = p.y - 280;
              return (
                <path
                  key={`out-${t.id}-${pid}`}
                  d={`M ${t.x + TRANSITION_HALF_W} ${t.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p.x + PLACE_R} ${p.y - 4}`}
                  strokeWidth={1.5}
                  markerEnd="url(#arrow)"
                  strokeDasharray="6 4"
                  strokeOpacity={0.28}
                />
              );
            }
            return (
              <line
                key={`out-${t.id}-${pid}`}
                x1={t.x + TRANSITION_HALF_W}
                y1={t.y}
                x2={p.x - PLACE_R}
                y2={p.y}
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
            );
          }),
        )}
      </g>

      <g>
        {PLACES.map((p) => {
          const filled = (tokens[p.id] ?? 0) > 0;
          return (
            <g key={p.id}>
              <polygon
                points={diamondPoints(p.x, p.y, PLACE_R)}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.7}
                strokeWidth={2.5}
                strokeLinejoin="miter"
              />
              <text
                x={p.x}
                y={p.y - PLACE_R - 14}
                textAnchor="middle"
                fontSize={13}
                fontWeight={700}
                letterSpacing={1.5}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fill="currentColor"
                fillOpacity={0.55}
              >
                {p.label.toUpperCase()}
              </text>
              {filled && (
                <polygon points={diamondPoints(p.x, p.y, TOKEN_R + 1)} fill="var(--accent)" />
              )}
              {(tokens[p.id] ?? 0) > 1 && (
                <text
                  x={p.x + 12}
                  y={p.y + 4}
                  fontSize={11}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  fill="var(--accent)"
                >
                  ×{tokens[p.id]}
                </text>
              )}
            </g>
          );
        })}
      </g>

      <g>
        {TRANSITIONS.map((t) => {
          const stripeCount = Math.max(2, Math.floor(t.h / (STRIPE_H + STRIPE_GAP)));
          const totalSpan = stripeCount * STRIPE_H + (stripeCount - 1) * STRIPE_GAP;
          const startY = t.y - totalSpan / 2;
          const isActive = pulsing.has(t.id);
          return (
            <g key={t.id} style={{ transition: "opacity 200ms" }}>
              {Array.from({ length: stripeCount }).map((_, i) => (
                <rect
                  key={`${t.id}-stripe-${i}`}
                  x={t.x - TRANSITION_HALF_W}
                  y={startY + i * (STRIPE_H + STRIPE_GAP)}
                  width={TRANSITION_HALF_W * 2}
                  height={STRIPE_H}
                  fill="currentColor"
                  fillOpacity={isActive ? 0.95 : i % 2 === 0 ? 0.75 : 0.4}
                  style={{ transition: "fill-opacity 200ms" }}
                />
              ))}
              <text
                x={t.x + TRANSITION_HALF_W + 14}
                y={startY - 10}
                textAnchor="start"
                fontSize={12}
                fontWeight={700}
                letterSpacing={1.5}
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fill="currentColor"
                fillOpacity={0.55}
              >
                {t.label.toUpperCase()}
              </text>
            </g>
          );
        })}
      </g>

      <g>
        {flights.map((f) => (
          <FlyingToken key={f.id} flight={f} />
        ))}
      </g>
    </svg>
  );
}
