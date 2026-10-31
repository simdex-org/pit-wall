// --sim-track: ACC's track id, the name the broadcast gives, metres, a GT3's lap (ms), litres a lap, laps between stops.
import tracks from "@pitwall/tracks" with { type: "json" };

export type SimTrack = readonly [id: string, name: string, metres: number, lapMs: number, litres: number, every: number];

export const SIM_TRACKS: Record<string, SimTrack> = {
  nordschleife: ["nurburgring_24h", "Nurburgring 24h", 25378.0, 497000, 25.0, 4],
  monza: ["monza", "Monza", 5793.0, 107500, 3.2, 18], spa: ["spa", "Spa-Francorchamps", 7004.0, 137500, 3.9, 16],
  silverstone: ["silverstone", "Silverstone", 5891.0, 118500, 3.2, 18], nurburgring: ["nurburgring", "Nurburgring", 5137.0, 114000, 2.8, 18],
  brands_hatch: ["brands_hatch", "Brands Hatch", 3908.0, 83500, 2.2, 22], suzuka: ["suzuka", "Suzuka", 5807.0, 120000, 3.2, 18],
  laguna_seca: ["laguna_seca", "Laguna Seca", 3602.0, 82500, 2.0, 22], mount_panorama: ["mount_panorama", "Mount Panorama", 6213.0, 121500, 3.4, 18],
  imola: ["imola", "Imola", 4909.0, 101000, 2.7, 20], barcelona: ["barcelona", "Barcelona", 4657.0, 103500, 2.6, 20],
  zandvoort: ["zandvoort", "Zandvoort", 4259.0, 95500, 2.3, 20], paul_ricard: ["paul_ricard", "Paul Ricard", 5770.0, 114000, 3.2, 18],
  hungaroring: ["hungaroring", "Hungaroring", 4381.0, 106000, 2.4, 20], misano: ["misano", "Misano", 4226.0, 93000, 2.3, 20],
  zolder: ["zolder", "Zolder", 4011.0, 87000, 2.2, 22], kyalami: ["kyalami", "Kyalami", 4529.0, 105000, 2.5, 20],
  cota: ["cota", "Circuit of the Americas", 5513.0, 133000, 3.0, 17], indianapolis: ["indianapolis", "Indianapolis", 3925.0, 96000, 2.2, 22],
  watkins_glen: ["watkins_glen", "Watkins Glen", 5430.0, 111000, 3.0, 18], red_bull_ring: ["red_bull_ring", "Red Bull Ring", 4318.0, 85000, 2.4, 20],
  valencia: ["valencia", "Valencia", 4005.0, 91000, 2.2, 22], donington: ["donington", "Donington Park", 4020.0, 88000, 2.2, 22],
  oulton_park: ["oulton_park", "Oulton Park", 4307.0, 94000, 2.4, 20], snetterton: ["snetterton", "Snetterton", 4778.0, 105000, 2.6, 20],
};

/** A track's loop in metres (x, z), scaled so its length is the real one. */
export function trackLoop(name: string, metres: number): [number, number][] {
  const pts = (tracks as unknown as Record<string, { loop: [number, number][] }>)[name]?.loop;
  if (!pts) throw new Error(`no loop for ${name}`);
  const n = pts.length;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n]!, b = pts[i]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const sc = metres / len;
  return pts.map(([x, z]) => [x * sc, z * sc]);
}
