import { RAIN } from "../lib/enums";

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg: number): string => POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;

/** The colour class for a rain level 0 to 5. */
export const tone = (lv: number): string => (lv >= 3 ? "up" : lv >= 1 ? "wn" : "mu");

/** The rain now, in 10 and in 30 minutes (levels 0 to 5) as a headline and a sentence. */
export function forecast(rain: number[], clouds: number | null) {
  const lv = (i: number) => Math.max(0, Math.min(5, Math.round(rain[i] ?? 0)));
  const now = lv(0), later = Math.max(lv(1), lv(2));
  const icon = now >= 4 || later >= 4 ? "cloud-lightning" : now >= 2 ? "cloud-rain" : now >= 1 ? "cloud-drizzle" : later >= 1 || (clouds ?? 0) > 60 ? "cloud" : "sun";
  const text = now >= 1 ? RAIN[now]! : later >= 1 ? `${RAIN[later]} coming` : "Dry";
  const sub = now === 0 && later === 0 ? (clouds != null ? `Clouds ${Math.round(clouds)} %` : "No rain in the next 30 minutes") : later > now ? "Getting worse" : later < now ? "Easing" : "Staying the same";
  return { lv, icon, text, sub, cls: tone(Math.max(now, later)) };
}
