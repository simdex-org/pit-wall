// vJoy: a virtual controller the MFD actions can be bound to, so the driver's keyboard is never touched.
import koffi from "koffi";
import { sleep } from "./mfd.js";

export const VJOY_BUTTONS = { pit: 1, up: 2, down: 3, left: 4, right: 5, close: 6 } as const;
const VJOY_DLL = "C:\\Program Files\\vJoy\\x64\\vJoyInterface.dll";

export interface VJoy {
  GetVJDStatus(dev: number): number;
  vJoyEnabled(): number;
  GetVJDButtonNumber(dev: number): number;
  AcquireVJD(dev: number): number;
  ResetVJD(dev: number): number;
  SetBtn(on: number, dev: number, btn: number): number;
  RelinquishVJD(dev: number): void;
}

/** vJoy's interface with device `dev` acquired for this program. Throws with what to fix. */
export function vjoyDevice(dev: number): VJoy {
  let lib: ReturnType<typeof koffi.load>;
  try { lib = koffi.load(VJOY_DLL); } catch { throw new Error(`vJoy is not installed (${VJOY_DLL} not found)`); }
  const vj: VJoy = {
    GetVJDStatus: lib.func("int GetVJDStatus(uint32 id)"),
    vJoyEnabled: lib.func("int vJoyEnabled()"),
    GetVJDButtonNumber: lib.func("int GetVJDButtonNumber(uint32 id)"),
    AcquireVJD: lib.func("int AcquireVJD(uint32 id)"),
    ResetVJD: lib.func("int ResetVJD(uint32 id)"),
    SetBtn: lib.func("int SetBtn(int value, uint32 id, uint8 btn)"),
    RelinquishVJD: lib.func("void RelinquishVJD(uint32 id)"),
  };
  const status = vj.GetVJDStatus(dev); // 0 owned by us, 1 free, 2 taken by another program, 3 missing
  if (!vj.vJoyEnabled() || status === 2 || status === 3 || vj.GetVJDButtonNumber(dev) < Math.max(...Object.values(VJOY_BUTTONS))) {
    throw new Error(`vJoy device ${dev} is not usable: it must exist, have at least 6 buttons and not be used by another program (Configure vJoy, device 1, 8 buttons)`);
  }
  if (status === 1 && !vj.AcquireVJD(dev)) throw new Error(`could not take vJoy device ${dev}`);
  vj.ResetVJD(dev);
  return vj;
}

export async function vjoyPress(vj: VJoy, dev: number, button: number, holdS: number): Promise<void> {
  if (!vj.SetBtn(1, dev, button)) throw new Error(`vJoy device ${dev} has no button ${button}: give it at least 6 buttons in Configure vJoy`);
  await sleep(holdS * 1000);
  vj.SetBtn(0, dev, button);
  await sleep(holdS * 1000);
}

/** Help bind ACC's MFD actions to the vJoy buttons: each one is pressed every second for 10 s, announced by beeps. */
export async function bindVjoy(dev = 1): Promise<void> {
  const vj = vjoyDevice(dev);
  const actions = [["pit", "MFD pitstop page"], ["up", "MFD up"], ["down", "MFD down"], ["left", "MFD left"], ["right", "MFD right"],
    ["close", "Cycle MFD (closes the pit page)"]] as const;
  console.log("In ACC open Options > Controls and find the MFD actions. Starting in 10 s.");
  console.log("For each action below: when you hear its beeps, click that action's binding in ACC; the button presses itself.");
  actions.forEach(([key, name], n) => console.log(`  ${n + 1} beep${n ? "s" : ""}: ${name} = vJoy button ${VJOY_BUTTONS[key]}`));
  await sleep(10000);
  for (const [n, [key, name]] of actions.entries()) {
    console.log(`now: ${name} (vJoy button ${VJOY_BUTTONS[key]}) - click it in ACC`);
    for (let b = 0; b <= n; b++) { process.stdout.write("\x07"); await sleep(250); }
    for (let k = 0; k < 10; k++) { await vjoyPress(vj, dev, VJOY_BUTTONS[key], 0.15); await sleep(700); }
  }
  vj.RelinquishVJD(dev);
  console.log("Done. Check in ACC that the six MFD actions show vJoy buttons 1 to 6.");
}
