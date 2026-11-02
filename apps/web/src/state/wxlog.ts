export interface WxSample { t: number; rain: number; wet: number | null; clouds: number | null; track: number; air: number; wind: number | null }

const EVERY_MS = 15000;
export const KEEP_MS = 30 * 60000;
const log: WxSample[] = [];

/** Adds a sample when the last one is old enough and drops what is past the window; the same list is shared by every weather module. */
export function wxSample(s: WxSample): WxSample[] {
  const last = log[log.length - 1];
  if (!last || s.t - last.t >= EVERY_MS) log.push(s);
  while (log.length && s.t - log[0]!.t > KEEP_MS) log.shift();
  return log;
}

let anchor = { t: 0, fc: [-1, -1] as [number, number] };

/** When ACC's +10 and +30 min forecast last changed. Its points stay on that moment, so the chart slides them toward Now until ACC says something new. */
export function wxForecastTime(t: number, fc: [number, number]): number {
  if (fc[0] !== anchor.fc[0] || fc[1] !== anchor.fc[1]) anchor = { t, fc };
  return anchor.t;
}

/** Change per minute over the last `windowMin` minutes, or null with under a minute of data. */
export function slopePerMin(samples: WxSample[], pick: (s: WxSample) => number | null, windowMin = 10): number | null {
  const end = samples[samples.length - 1];
  if (!end) return null;
  const from = samples.find((s) => end.t - s.t <= windowMin * 60000 && pick(s) != null);
  const a = from && pick(from), b = pick(end);
  if (!from || a == null || b == null || end.t - from.t < 60000) return null;
  return (b - a) / ((end.t - from.t) / 60000);
}
