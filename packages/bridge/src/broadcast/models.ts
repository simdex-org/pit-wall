// ACC car model ids (byte in ENTRY_LIST_CAR) -> name, class. Unknown ids show as "Unknown", "?".
export const LOCS = ["none", "track", "pit", "entry", "exit"];
export const PIT_LOCS = [2, 3, 4];
export const CUPS = ["Pro", "Pro-Am", "Am", "Silver", "National"];
export const PHASES = ["none", "starting", "pre-formation", "formation", "pre-session", "green", "over", "post", "results"];
/** Broadcasting RaceSessionType.Race (shared memory says 2; only the broadcast and telemetry code convert). */
export const RACE = 10;

export const MODELS: Record<number, [name: string, cls: string]> = {
  0: ["Porsche 991 GT3 R", "GT3"], 1: ["Mercedes-AMG GT3", "GT3"], 2: ["Ferrari 488 GT3", "GT3"], 3: ["Audi R8 LMS", "GT3"],
  4: ["Lamborghini Huracan GT3", "GT3"], 5: ["McLaren 650S GT3", "GT3"], 6: ["Nissan GT-R Nismo GT3 2018", "GT3"],
  7: ["BMW M6 GT3", "GT3"], 8: ["Bentley Continental GT3 2018", "GT3"], 9: ["Porsche 991 II GT3 Cup", "GTC"],
  10: ["Nissan GT-R Nismo GT3 2015", "GT3"], 11: ["Bentley Continental GT3 2015", "GT3"], 12: ["AMR V12 Vantage GT3", "GT3"],
  13: ["Reiter Engineering R-EX GT3", "GT3"], 14: ["Emil Frey Jaguar G3", "GT3"], 15: ["Lexus RC F GT3", "GT3"],
  16: ["Lamborghini Huracan GT3 Evo", "GT3"], 17: ["Honda NSX GT3", "GT3"], 18: ["Lamborghini Huracan ST", "GTC"],
  19: ["Audi R8 LMS Evo", "GT3"], 20: ["AMR V8 Vantage GT3", "GT3"], 21: ["Honda NSX GT3 Evo", "GT3"],
  22: ["McLaren 720S GT3", "GT3"], 23: ["Porsche 911 II GT3 R", "GT3"], 24: ["Ferrari 488 GT3 Evo", "GT3"],
  25: ["Mercedes-AMG GT3 2020", "GT3"], 26: ["Ferrari 488 Challenge Evo", "GTC"], 27: ["BMW M2 CS Racing", "TCX"],
  28: ["Porsche 992 GT3 Cup", "GTC"], 29: ["Lamborghini Huracan ST Evo2", "GTC"], 30: ["BMW M4 GT3", "GT3"],
  31: ["Audi R8 LMS GT3 Evo II", "GT3"], 32: ["Ferrari 296 GT3", "GT3"], 33: ["Lamborghini Huracan GT3 Evo2", "GT3"],
  34: ["Porsche 992 GT3 R", "GT3"], 35: ["McLaren 720S GT3 Evo", "GT3"], 36: ["Ford Mustang GT3", "GT3"],
  50: ["Alpine A110 GT4", "GT4"], 51: ["AMR V8 Vantage GT4", "GT4"], 52: ["Audi R8 LMS GT4", "GT4"], 53: ["BMW M4 GT4", "GT4"],
  55: ["Chevrolet Camaro GT4", "GT4"], 56: ["Ginetta G55 GT4", "GT4"], 57: ["KTM X-Bow GT4", "GT4"], 58: ["Maserati MC GT4", "GT4"],
  59: ["McLaren 570S GT4", "GT4"], 60: ["Mercedes-AMG GT4", "GT4"], 61: ["Porsche 718 Cayman GT4", "GT4"],
  80: ["Audi R8 LMS GT2", "GT2"], 82: ["KTM X-Bow GT2", "GT2"], 83: ["Maserati MC20 GT2", "GT2"],
  84: ["Mercedes-AMG GT2", "GT2"], 85: ["Porsche 911 GT2 RS CS Evo", "GT2"], 86: ["Porsche 935", "GT2"],
};
