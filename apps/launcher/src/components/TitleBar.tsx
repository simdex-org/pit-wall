import { getCurrentWindow } from "@tauri-apps/api/window";

const win = () => getCurrentWindow();

function Control({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className={`grid h-9 w-[46px] cursor-pointer place-items-center text-text ${danger ? "hover:bg-bad hover:text-bg" : "hover:bg-line"}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">{children}</svg>
    </button>
  );
}

export function TitleBar() {
  return (
    <div data-tauri-drag-region className="flex h-9 shrink-0 items-center border-b border-line bg-panel pl-3.5">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="pointer-events-none">
        <rect x="1" y="1" width="12" height="12" fill="none" stroke="#2ad4c4" strokeWidth="2" />
        <rect x="4.5" y="4.5" width="5" height="5" fill="#2ad4c4" />
      </svg>
      <span className="pointer-events-none ml-[9px] text-[12px] tracking-[.04em] text-muted">Pit Wall</span>
      <span data-tauri-drag-region className="flex-1 self-stretch" />
      <Control label="Minimise" onClick={() => win().minimize()}><path d="M0 5h10" /></Control>
      <Control label="Maximise" onClick={() => win().toggleMaximize()}><rect x="0.5" y="0.5" width="9" height="9" /></Control>
      <Control label="Close" danger onClick={() => win().close()}><path d="M0 0l10 10M10 0L0 10" /></Control>
    </div>
  );
}
