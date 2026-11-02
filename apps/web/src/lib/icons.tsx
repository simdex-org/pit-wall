import type { ReactNode } from "react";

// One drawn set on a 24 grid: square caps, mitred joins and a flat 2px stroke, like technical drawing symbols.
const P: Record<string, ReactNode> = {
  activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  disc: <><circle r="9" cx="12" cy="12" /><path d="M12 8v8M8 12h8" /></>,
  gauge: <><path d="M3 18a9 9 0 1 1 18 0" /><path d="M12 18l5-7" /></>,
  "square-parking": <><path d="M4 4h16v16H4z" /><path d="M9 17V7h4a3 3 0 0 1 0 6H9" /></>,
  wrench: <path d="M15 3a5 5 0 0 0-4 7L3 18l3 3 8-8a5 5 0 0 0 7-4l-3 3-3-1-1-3z" />,
  "chevron-down": <path d="M5 9l7 7 7-7" />,
  "circle-check": <><path d="M3 3h18v18H3z" /><path d="M7 12l4 4 6-8" /></>,
  cloud: <path d="M6 18h12a4 4 0 0 0 0-8 6 6 0 0 0-11-1 4.5 4.5 0 0 0-1 9z" />,
  "cloud-drizzle": <><path d="M6 14h12a4 4 0 0 0 0-8 6 6 0 0 0-11-1 4.5 4.5 0 0 0-1 9z" /><path d="M8 18v2M12 18v2M16 18v2" /></>,
  "cloud-rain": <><path d="M6 14h12a4 4 0 0 0 0-8 6 6 0 0 0-11-1 4.5 4.5 0 0 0-1 9z" /><path d="M8 17l-1 4M12 17l-1 4M16 17l-1 4" /></>,
  "cloud-lightning": <><path d="M6 14h12a4 4 0 0 0 0-8 6 6 0 0 0-11-1 4.5 4.5 0 0 0-1 9z" /><path d="M13 14l-3 4h4l-3 4" /></>,
  sun: <><path d="M8 8h8v8H8z" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
  copy: <><path d="M8 8h12v12H8z" /><path d="M16 8V4H4v12h4" /></>,
  crosshair: <><circle r="7" cx="12" cy="12" /><path d="M12 2v6M12 16v6M2 12h6M16 12h6" /></>,
  droplets: <path d="M12 3l6 9a6 6 0 1 1-12 0z" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><path d="M10 10h4v4h-4z" /></>,
  "eye-off": <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><path d="M3 21L21 3" /></>,
  flame: <path d="M12 2c1 5 6 7 6 13a6 6 0 0 1-12 0c0-3 2-4 3-7 1 1 2 2 3 2 0-3-1-5 0-8z" />,
  "panel-right": <><path d="M3 4h18v16H3z" /><path d="M15 4v16" /></>,
  tag: <path d="M3 3h9l9 9-9 9-9-9z" />,
  "grip-vertical": <path d="M9 5v.01M9 12v.01M9 19v.01M15 5v.01M15 12v.01M15 19v.01" strokeWidth="3" />,
  inbox: <path d="M3 13l3-9h12l3 9v7H3zM3 13h6l1 3h4l1-3h6" />,
  info: <><path d="M3 3h18v18H3z" /><path d="M12 11v6M12 7v.01" /></>,
  keyboard: <><path d="M2 6h20v12H2z" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  "layout-dashboard": <path d="M3 3h8v10H3zM13 3h8v6h-8zM13 11h8v10h-8zM3 15h8v6H3z" />,
  lock: <><path d="M5 11h14v10H5z" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  maximize: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  pencil: <path d="M4 20l1-5L16 4l4 4L9 19zM13 7l4 4" />,
  "octagon-alert": <><path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" /><path d="M12 7v6M12 17v.01" /></>,
  pause: <path d="M8 4v16M16 4v16" strokeWidth="3.5" />,
  play: <path d="M6 4l14 8-14 8z" />,
  plus: <path d="M12 4v16M4 12h16" />,
  "redo-2": <path d="M20 8H9a6 6 0 0 0 0 12h4M16 4l4 4-4 4" />,
  settings: <path d="M3 7h9M18 7h3M3 17h3M12 17h9M12 4h6v6h-6zM6 14h6v6H6z" />,
  "sliders-horizontal": <path d="M3 7h6M15 7h6M3 17h12M19 17h2M9 4h6v6H9zM15 14h4v6h-4z" />,
  "triangle-alert": <><path d="M12 3L2 21h20z" /><path d="M12 10v5M12 18v.01" /></>,
  "undo-2": <path d="M4 8h11a6 6 0 0 1 0 12h-4M8 4L4 8l4 4" />,
  unplug: <path d="M3 21l5-5M16 8l5-5M7 11l6 6M11 7l6 6" />,
  users: <><path d="M8 4h4v6H8zM2 20v-4h12v4" /><path d="M16 8h3v5h-3zM17 16h5v4" /></>,
  x: <path d="M5 5l14 14M19 5L5 19" />,
};

/** An icon by name; modules name their tool icons as strings. */
export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const g = P[name];
  return g ? (
    <svg className="lucide" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>{g}</svg>
  ) : null;
}
