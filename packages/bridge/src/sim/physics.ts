// What a GT3 can do, in m/s and m/s². Corners, braking and pulling share the tyres, so each is cut down by the corner's load.
export const G = 9.81;
export const TOP_SPEED = 78;

const aero = (v: number): number => 1 + 0.35 * (v / 60) ** 2;
/** Cornering limit: 1.7 g on the tyres, more with downforce. */
export const latMax = (v: number): number => 1.7 * G * aero(v);
/** Air and rolling drag. */
export const drag = (v: number): number => 0.5 + 0.00046 * v * v;
/** Pulling: traction at low speed, power (about 370 kW in 1300 kg) above it, less the drag. */
export const accCap = (v: number): number => Math.max(0.3, Math.min(9.2, 285 / Math.max(v, 5)) - drag(v));
/** Braking: tyres (more with downforce) plus the drag, about 1.4 g slow and 2.1 g fast. */
export const brakeCap = (v: number): number => (1.3 + 0.55 * (v / 80) ** 2) * G + drag(v);
/** Share of the straight-line figure left when the corner takes `use` (0 to 1) of the grip: the friction circle. */
export const circle = (use: number): number => Math.sqrt(Math.max(0.02, 1 - Math.min(1, use) ** 2));
