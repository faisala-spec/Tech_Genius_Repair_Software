"use client";

// Sales vs costs per day (or month). Two series, one $ axis, legend + hover details.
// Colours are theme tokens validated for colour-blind readers in light and dark (app/globals.css).
import { useState } from "react";

type Point = { date: string; sales_cents: number; costs_cents: number };

const money = (c: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: Math.abs(c) >= 100000 ? 0 : 2 }).format(c / 100);
const short = (c: number) => (Math.abs(c) >= 100000 ? `$${(c / 100000).toFixed(Math.abs(c) >= 1000000 ? 0 : 1)}k` : `$${Math.round(c / 100)}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (d: string, by: string) => {
  const [, m, day] = d.split("-").map(Number);
  return by === "month" ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${day}`;
};

export default function SalesChart({ data, by }: { data: Point[]; by: "day" | "month" }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...data.map((d) => Math.max(d.sales_cents, d.costs_cents)));
  const top = niceMax(max);
  const W = 720, H = 230, L = 48, R = 8, T = 10, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const slot = iw / Math.max(data.length, 1);
  const bw = Math.max(2, Math.min(14, (slot - 4) / 2));
  const y = (v: number) => T + ih - (top ? (Math.max(v, 0) / top) * ih : 0);
  const every = Math.ceil(data.length / 10);
  const h = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-2 flex justify-end gap-4 text-xs text-zinc-600">
        <Legend color="var(--color-chart-sales)" text="Sales (before tax)" />
        <Legend color="var(--color-chart-costs)" text="Costs & expenses" />
      </div>
      {!max ? (
        <div className="flex h-[200px] items-center justify-center rounded-lg bg-zinc-50 text-sm text-zinc-500">Nothing recorded in this period yet.</div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Sales and costs by ${by}`}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={L} x2={W - R} y1={y(f * top)} y2={y(f * top)} stroke="var(--color-zinc-200)" strokeWidth={1} />
                <text x={L - 6} y={y(f * top) + 4} textAnchor="end" fontSize={11} fill="var(--color-zinc-500)">
                  {short(f * top)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = L + slot * i + (slot - (bw * 2 + 2)) / 2;
              return (
                <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={L + slot * i} y={T} width={slot} height={ih} fill={hover === i ? "var(--color-zinc-100)" : "transparent"} />
                  <Bar x={x0} w={bw} top={y(d.sales_cents)} base={T + ih} fill="var(--color-chart-sales)" dim={hover !== null && hover !== i} />
                  <Bar x={x0 + bw + 2} w={bw} top={y(d.costs_cents)} base={T + ih} fill="var(--color-chart-costs)" dim={hover !== null && hover !== i} />
                  {i % every === 0 && (
                    <text x={L + slot * i + slot / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-zinc-500)">
                      {label(d.date, by)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {h && hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-48 -translate-x-1/2 rounded-lg border border-zinc-200 bg-surface p-2.5 text-xs shadow-lg"
              style={{ left: `${Math.min(85, Math.max(15, ((L + slot * hover + slot / 2) / W) * 100))}%` }}
            >
              <p className="mb-1 font-semibold text-zinc-900">{label(h.date, by)}</p>
              <Row k="Sales" v={money(h.sales_cents)} />
              <Row k="Costs" v={money(h.costs_cents)} />
              <Row k="Profit" v={money(h.sales_cents - h.costs_cents)} strong />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Bar({ x, w, top, base, fill, dim }: { x: number; w: number; top: number; base: number; fill: string; dim: boolean }) {
  const hgt = base - top;
  if (hgt <= 0) return null;
  const r = Math.min(4, w / 2, hgt);
  return <path d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`} fill={fill} opacity={dim ? 0.45 : 1} />;
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {text}
    </span>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "border-t border-zinc-200 pt-1 font-semibold text-zinc-900" : "text-zinc-600"}`}>
      <span>{k}</span>
      <span className="text-zinc-900">{v}</span>
    </div>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
