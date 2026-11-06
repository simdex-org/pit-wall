import { useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex, Hsv } from "../lib/color";

function Drag({ className, onMove, style, children, label }: { className: string; onMove: (x: number, y: number) => void; style?: React.CSSProperties; children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  return (
    <div ref={ref} className={className} style={style} aria-label={label} role="presentation"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e); }}>{children}</div>
  );
}

export function ColorPicker({ value, label, onChange }: { value: string; label: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const box = useRef<HTMLSpanElement>(null);
  const last = useRef(value);

  useEffect(() => { if (value !== last.current) { last.current = value; setHsv(hexToHsv(value)); } }, [value]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);

  const set = (n: Hsv) => { setHsv(n); const hex = hsvToHex(n); last.current = hex; onChange(hex); };
  const [h, s, v] = hsv;
  return (
    <span className="cp" ref={box}>
      <button type="button" className="cp-sw" style={{ background: value }} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)} />
      {open ? (
        <div className="cp-pop">
          <Drag className="cp-sv" label="Saturation and brightness" style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${h} 100% 50%))` }} onMove={(x, y) => set([h, x, 1 - y])}>
            <i style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
          </Drag>
          <Drag className="cp-hue" label="Hue" onMove={(x) => set([x * 360 - (x === 1 ? 0.001 : 0), s, v])}>
            <i style={{ left: `${(h / 360) * 100}%` }} />
          </Drag>
        </div>
      ) : null}
    </span>
  );
}
