"use client";

import { useState } from "react";

type Point = { label: string; revenue: number; profit: number; count: number; future: boolean };

const fmt = (v: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: v >= 1000 ? 0 : 2 }).format(v);
const short = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`);

/** Revenue per day (or month) as thin bars. Hover a bar for revenue, profit and invoice count. */
export default function RevenueChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.revenue), 0);
  const nice = niceMax(max);
  const W = 720, H = 220, L = 44, R = 8, T = 10, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const slot = iw / Math.max(data.length, 1);
  const bw = Math.max(3, Math.min(28, slot * 0.6));
  const y = (v: number) => T + ih - (nice ? (v / nice) * ih : 0);
  const ticks = [0, 0.5, 1].map((f) => f * nice);
  const every = Math.ceil(data.length / 10); // label at most ~10 bars
  const h = hover !== null ? data[hover] : null;

  if (!max) {
    return <div className="flex h-[220px] items-center justify-center rounded-lg bg-zinc-50 text-sm text-zinc-500">No sales in this period yet.</div>;
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Revenue by day">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e4e4e7" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#71717a">
              {short(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = L + slot * i + slot / 2;
          const top = y(d.revenue);
          const hgt = T + ih - top;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Hit target: the whole column, bigger than the bar */}
              <rect x={L + slot * i} y={T} width={slot} height={ih} fill={hover === i ? "#f4f4f5" : "transparent"} />
              {d.revenue > 0 && (
                <path
                  d={roundedTop(cx - bw / 2, top, bw, hgt, Math.min(4, bw / 2, hgt))}
                  fill="#E28E34"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {i % every === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={d.future ? "#a1a1aa" : "#71717a"}>
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-44 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs shadow-lg"
          style={{ left: `${((L + slot * hover + slot / 2) / W) * 100}%` }}
        >
          <p className="mb-1 font-semibold text-zinc-900">{h.label}</p>
          <Row k="Revenue" v={fmt(h.revenue)} />
          <Row k="Gross profit" v={fmt(h.profit)} />
          <Row k="Invoices" v={String(h.count)} />
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 text-zinc-600">
      <span>{k}</span>
      <span className="font-medium text-zinc-900">{v}</span>
    </div>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Bar with 4px rounded top, square at the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}
