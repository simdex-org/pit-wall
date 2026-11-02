import { Button, Card } from "./ui";

export function CloseDialog({ onKeep, onQuit }: { onKeep: () => void; onQuit: () => void }) {
  return (
    <Card className="flex flex-col gap-3.5 border-warn px-[18px] py-4">
      <div role="alertdialog" aria-label="Close Pit Wall" className="text-[16px] leading-[1.4]">
        <span className="font-bold">Stop Pit Wall and close the window?</span> Your engineer loses the dashboard until you start it again.
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Button onClick={onKeep} className="h-[46px] rounded bg-accent text-[15px] font-bold tracking-[.08em] text-bg">KEEP RUNNING</Button>
        <Button kind="danger" onClick={onQuit} className="h-[46px] text-[15px] tracking-[.08em]">STOP AND CLOSE</Button>
      </div>
    </Card>
  );
}
