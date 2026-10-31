/** mulberry32: a small seeded generator, so the pretend session is the same every run. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const uniform = (lo: number, hi: number) => lo + (hi - lo) * random();
  /** Box-Muller. */
  const normal = (mean = 0, sd = 1) => mean + sd * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  return { random, uniform, normal, randint: (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1)) };
}
export type Rng = ReturnType<typeof rng>;
