import type { Car } from "../feed/types";

type Form = "full" | "last" | "code" | "short";

/** A driver's name in one of four forms; the car number when the entry list has no driver yet. */
export function carName(car: Car | null | undefined, form: Form = "short"): string {
  if (!car) return "";
  const ds = car.drivers ?? [];
  const d = ds[car.drv | 0] ?? ds[0];
  if (!d) return car.num != null ? "#" + car.num : "";
  const first = d.first || "", last = d.last || "";
  if (form === "full") return `${first} ${last}`.trim();
  if (form === "last") return last || first;
  if (form === "code") return d.short || last.slice(0, 3).toUpperCase();
  return (first ? first[0] + ". " : "") + last;
}
