export const G = 9.81;
export const TOP_SPEED = 78;

const aero = (v: number): number => 1 + 0.35 * (v / 60) ** 2;
export const latMax = (v: number): number => 1.7 * G * aero(v);
export const drag = (v: number): number => 0.5 + 0.00046 * v * v;
export const accCap = (v: number): number => Math.max(0.3, Math.min(9.2, 285 / Math.max(v, 5)) - drag(v));
export const brakeCap = (v: number): number => (1.3 + 0.55 * (v / 80) ** 2) * G + drag(v);
export const circle = (use: number): number => Math.sqrt(Math.max(0.02, 1 - Math.min(1, use) ** 2));
