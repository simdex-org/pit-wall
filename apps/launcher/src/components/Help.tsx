import { Button } from "./ui";

const items = [
  ["IP address", "The address your engineer types in their browser. Use your VPN address (Hamachi, Radmin, Tailscale). 127.0.0.1 means only this PC can open the dashboard."],
  ["Port", "The port the dashboard answers on. Leave it at 8765 unless something else uses it."],
  ["Anyone with the link can edit the pit stop", "Off: the link carries a secret key, and only people holding that link can see the data or send pit plans. On: there is no key. Anyone who can reach the address sees everything and can change the pit stop, so use it only on a VPN you trust."],
  ["Press the pit page through vJoy", "Sends the MFD presses through a vJoy device instead of the keyboard. Needs vJoy installed. Bind in ACC assigns vJoy buttons 1 to 6 to ACC's MFD actions once."],
  ["Link for your engineer", "What to send to your engineer. It changes only if you change the address, port or the switch above."],
] as const;

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-label="Help" className="fixed inset-0 z-10 flex items-center justify-center bg-bg/80 p-5" onClick={onClose}>
      <div className="flex max-h-full w-full flex-col gap-3 overflow-auto rounded-md border border-edge bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-[18px] font-bold tracking-[.1em]">HOW IT WORKS</div>
        {items.map(([t, d]) => (
          <div key={t}>
            <div className="text-[14px] font-semibold text-accent">{t}</div>
            <div className="text-[14px] leading-[1.45] text-muted">{d}</div>
          </div>
        ))}
        <Button onClick={onClose} className="h-10 text-[14px] font-bold tracking-[.08em]">CLOSE</Button>
      </div>
    </div>
  );
}
