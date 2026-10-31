// Strings from the feed end up in the page, so only these keys may stay strings. Every other string becomes a number (NaN when
// it is not one), which keeps text the bridge never meant to send out of the DOM.
const TEXT_KEYS = new Set([
  "what", "from", "magic", "game", "driver", "app_version", "car_model", "track", "track_config", "driver_name", "kind", "status",
  "compound", "text", "id", "track_status", "car_class", "loc", "mode", "first", "last", "short", "team", "model_name", "class", "cup_name",
  "name", "cat", "by", "msg", "state", "fuel_and_tyres", "lap_ref_src", "laps_src", "best_src", "drive_loss_src", "refuel_src", "tyre_src",
  "stops_why", "src", "label", "only", "busy",
]);

export function numbersOnly<T = unknown>(o: unknown, key?: string): T {
  if (typeof o === "string") return (TEXT_KEYS.has(key ?? "") ? o : Number(o)) as T;
  if (Array.isArray(o)) return o.map((v) => numbersOnly(v, key)) as T;
  if (o && typeof o === "object") {
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, numbersOnly(v, k)])) as T;
  }
  return o as T;
}
