import { Choice, Games, stateText } from "../lib/games";
import { Button, Caption, Card } from "./ui";

interface Props {
  games: Games;
  choice: Choice;
  onChoice: (c: Choice) => void;
  installing: boolean;
  onInstall: () => void;
}

const CHOICES: [Choice, string][] = [["auto", "AUTO"], ["acc", "ACC"], ["ac", "AC"], ["lmu", "LMU"]];

export function GameCard({ games, choice, onChoice, installing, onInstall }: Props) {
  const { ac } = games;
  return (
    <Card className="flex flex-col gap-3 border-line p-[18px]">
      <div className="flex items-center justify-between">
        <Caption>GAME</Caption>
        <div role="group" aria-label="Game" className="flex overflow-hidden rounded border border-edge">
          {CHOICES.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={choice === id} onClick={() => onChoice(id)}
              className={`h-7 cursor-pointer px-3 text-[12px] font-bold tracking-[.1em] ${choice === id ? "bg-accent text-bg" : "text-muted hover:text-text"}`}>{label}</button>
          ))}
        </div>
      </div>
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[14px]">
        <dt>Assetto Corsa Competizione</dt>
        <dd className={`m-0 text-right ${games.acc.running ? "text-ok" : "text-muted"}`}>{stateText(games.acc)}</dd>
        <dt>Assetto Corsa</dt>
        <dd className={`m-0 text-right ${ac.running ? "text-ok" : "text-muted"}`}>{stateText(ac)}</dd>
        <dt>Le Mans Ultimate</dt>
        <dd className={`m-0 text-right ${games.lmu.running ? "text-ok" : "text-muted"}`}>{stateText(games.lmu)}</dd>
      </dl>
      {games.lmu.installed && (choice === "lmu" || (choice === "auto" && games.lmu.running)) && (
        <p className="m-0 border-t border-line pt-3 text-[12px] leading-[1.45] text-muted">
          Le Mans Ultimate shares its data only with Settings, Gameplay, Enable Plugins switched on, then the game restarted. Pit plans go to its pit menu through its own web API, no keys pressed.
        </p>
      )}
      {ac.installed && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {ac.app === "current" ? (
            <div className="text-[13px] text-ok">Pit Wall app installed in Assetto Corsa. Switch it on in the in-game app bar.</div>
          ) : (
            <>
              <p className="m-0 text-[13px] leading-[1.45]">Assetto Corsa needs the Pit Wall app to send the other cars, the flags and the session.</p>
              <Button kind="warn" className="h-9 w-full text-[13px]" onClick={onInstall} disabled={installing}>
                {installing ? "INSTALLING…" : ac.app === "old" ? "UPDATE THE PIT WALL APP" : "INSTALL THE PIT WALL APP FOR ASSETTO CORSA"}
              </Button>
              <p className="m-0 text-[12px] leading-[1.45] text-muted">
                Copies two files into apps/lua/PitWall in your Assetto Corsa folder. Content Manager lists it under Apps there.
              </p>
            </>
          )}
          {ac.csp === false && <p className="m-0 text-[12px] leading-[1.45] text-warn">Custom Shaders Patch was not found. The app needs it to run.</p>}
        </div>
      )}
    </Card>
  );
}
