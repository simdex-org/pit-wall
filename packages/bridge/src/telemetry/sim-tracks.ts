// --sim-track: ACC's track id, the name the broadcast gives, metres, a GT3's lap (ms), litres a lap.
import { scaleLoop } from "../sim/circuit.js";
import tracks from "@pitwall/tracks" with { type: "json" };

export type SimTrack = readonly [id: string, name: string, metres: number, lapMs: number, litres: number];

export const SIM_TRACKS: Record<string, SimTrack> = {
  nordschleife: ["nurburgring_24h", "Nurburgring 24h", 25378.0, 497000, 25.0],
  monza: ["monza", "Monza", 5793.0, 107500, 3.2], spa: ["spa", "Spa-Francorchamps", 7004.0, 137500, 3.9],
  silverstone: ["silverstone", "Silverstone", 5891.0, 118500, 3.2], nurburgring: ["nurburgring", "Nurburgring", 5137.0, 114000, 2.8],
  brands_hatch: ["brands_hatch", "Brands Hatch", 3908.0, 83500, 2.2], suzuka: ["suzuka", "Suzuka", 5807.0, 120000, 3.2],
  laguna_seca: ["laguna_seca", "Laguna Seca", 3602.0, 82500, 2.0], mount_panorama: ["mount_panorama", "Mount Panorama", 6213.0, 121500, 3.4],
  imola: ["imola", "Imola", 4909.0, 101000, 2.7], barcelona: ["barcelona", "Barcelona", 4657.0, 103500, 2.6],
  zandvoort: ["zandvoort", "Zandvoort", 4259.0, 95500, 2.3], paul_ricard: ["paul_ricard", "Paul Ricard", 5770.0, 114000, 3.2],
  hungaroring: ["hungaroring", "Hungaroring", 4381.0, 106000, 2.4], misano: ["misano", "Misano", 4226.0, 93000, 2.3],
  zolder: ["zolder", "Zolder", 4011.0, 87000, 2.2], kyalami: ["kyalami", "Kyalami", 4529.0, 105000, 2.5],
  cota: ["cota", "Circuit of the Americas", 5513.0, 133000, 3.0], indianapolis: ["indianapolis", "Indianapolis", 3925.0, 96000, 2.2],
  watkins_glen: ["watkins_glen", "Watkins Glen", 5430.0, 111000, 3.0], red_bull_ring: ["red_bull_ring", "Red Bull Ring", 4318.0, 85000, 2.4],
  valencia: ["valencia", "Valencia", 4005.0, 91000, 2.2], donington: ["donington", "Donington Park", 4020.0, 88000, 2.2],
  oulton_park: ["oulton_park", "Oulton Park", 4307.0, 94000, 2.4], snetterton: ["snetterton", "Snetterton", 4778.0, 105000, 2.6],
};

/** A track's loop in metres (x, z), scaled so its length is the real one. */
export function trackLoop(name: string, metres: number): [number, number][] {
  const pts = (tracks as unknown as Record<string, { loop: [number, number][] }>)[name]?.loop;
  if (!pts) throw new Error(`no loop for ${name}`);
  return scaleLoop(pts, metres);
}
