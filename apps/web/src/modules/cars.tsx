import { Fragment, KeyboardEvent, ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { Ctx } from "../feed/store";
import { feed } from "../feed/store";
import type { Car } from "../feed/types";
import { carName } from "../lib/cars";
import { IN_LANE } from "../lib/enums";
import { clamp } from "../lib/format";

export const sortedCars = (c: Ctx): Car[] => [...c.cars.values()].filter((x) => x.pos > 0).sort((a, b) => a.pos - b.pos);
export const fieldOn = (c: Ctx): boolean => !!(c.field && c.bc?.state === "live");

/** A driver with no surname shows the first name. */
export function driver(car: Car, form: "full" | "last" | "short" | "code" = "short"): string {
  const n = carName(car, form);
  return /^\S\. *$/.test(n) ? carName(car, "full") : n;
}

export const carNum = (car: Car | null | undefined): string => (car && car.num != null ? "#" + car.num : "");
export const carTitle = (car: Car): string => [carName(car, "full"), car.team, car.model_name].filter(Boolean).join(" · ");

const carLoc = (car: Car): string => (IN_LANE.includes(car.loc) ? car.loc : car.loc === "track" ? (car.out ? "out" : "track") : "none");

/** One state: in the lane, then out-lap, then in-lap. */
export function CarTags({ car }: { car: Car }) {
  if (IN_LANE.includes(car.loc)) return <b className="tag pit">PIT</b>;
  if (car.out) return <b className="tag out">OUT</b>;
  if (car.in) return <b className="tag in">IN</b>;
  return null;
}

export const YouTag = () => <b className="tag you">YOU</b>;

/** Up and down move a row cursor, Enter makes that car the focus car. */
export function useRowCursor(order: number[]): { cursor: number | null; onKey: (e: KeyboardEvent) => boolean } {
  const [cursor, setCursor] = useState<number | null>(null);
  const onKey = (e: KeyboardEvent): boolean => {
    if (!order.length) return false;
    const k = cursor == null ? -1 : order.indexOf(cursor);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const start = k < 0 ? Math.max(0, order.indexOf(typeof feed.get().focus === "number" ? (feed.get().focus as number) : (feed.get().me ?? -1))) : clamp(k + (e.key === "ArrowDown" ? 1 : -1), 0, order.length - 1);
      setCursor(order[start]!);
      return true;
    }
    if (e.key === "Enter" && k >= 0) { feed.setFocus(order[k]!); return true; }
    return false;
  };
  return { cursor, onKey };
}

/** The row every car table shares: status bar, own car, focus car and keyboard cursor. */
export function CarTr({ car, c, cursor, extra, p, children }: { car: Car; c: Ctx; cursor?: number | null; extra?: string; p?: number; children: ReactNode }) {
  const me = car.i === c.me, foc = c.focus !== "self" && car.i === c.focus;
  const cls = [me && "own", foc && "foc", cursor === car.i && "kcur", extra].filter(Boolean).join(" ");
  const row = useRef<HTMLTableRowElement | null>(null), last = useRef(car.pos);
  useLayoutEffect(() => {
    const was = last.current;
    last.current = car.pos;
    const el = row.current;
    if (!el || !was || !car.pos || was === car.pos || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
    const gain = car.pos < was, rows = Math.min(Math.abs(was - car.pos), 6) * el.offsetHeight;
    const tint = `color-mix(in srgb,var(${gain ? "--ok" : "--bad"}) 28%,transparent)`;
    el.animate(
      [{ transform: `translateY(${gain ? rows : -rows}px)`, backgroundColor: tint }, { transform: "none", backgroundColor: tint, offset: 0.45 }, { transform: "none", backgroundColor: "transparent" }],
      { duration: 1100, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }, [car.pos]);
  return (
    <tr data-i={car.i} data-p={p} data-loc={carLoc(car)} className={cls || undefined} aria-selected={foc || undefined}
      ref={(el) => { row.current = el; if (el && cursor === car.i) el.scrollIntoView({ block: "nearest" }); }} onClick={() => feed.setFocus(car.i)}>
      {children}
    </tr>
  );
}

/** A line of a small line chart: 1.5 px, the last point dotted, min and max at the right. */
export function Spark({ values, fmt }: { values: (number | null | undefined)[] | null | undefined; fmt: (v: number) => string }) {
  const v = (values ?? []).filter((x): x is number => x != null && isFinite(x));
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), W = 72, H = 18;
  const x = (i: number) => 1 + (i * (W - 4)) / (v.length - 1);
  const y = (a: number) => H - 2 - (H - 4) * (hi > lo ? (a - lo) / (hi - lo) : 0.5);
  return (
    <span className="spk">
      <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <polyline points={v.map((a, i) => `${x(i).toFixed(1)},${y(a).toFixed(1)}`).join(" ")} />
        <circle cx={x(v.length - 1).toFixed(1)} cy={y(v[v.length - 1]!).toFixed(1)} r="1.5" />
      </svg>
      <span className="note">{fmt(lo)}–{fmt(hi)}</span>
    </span>
  );
}

export function Kv({ rows, className }: { className?: string; rows: ([ReactNode, ReactNode] | [ReactNode, ReactNode, string] | false | null | undefined)[] }) {
  return (
    <dl className={"kv" + (className ? " " + className : "")}>
      {rows.filter(Boolean).map((r, i) => {
        const [k, v, cls] = r as [ReactNode, ReactNode, string?];
        return <Fragment key={i}><dt>{k}</dt><dd className={"n" + (cls ? " " + cls : "")}>{v}</dd></Fragment>;
      })}
    </dl>
  );
}
