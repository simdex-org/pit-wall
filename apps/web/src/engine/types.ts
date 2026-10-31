import type { KeyboardEvent, ReactNode } from "react";
import type { Ctx } from "../feed/store";

/** What a module reads. A module is re-rendered only when one of its channels changed, and at most `rate` times a second. */
export type Channel = "reading" | "summary" | "field" | "entries" | "laps" | "config" | "pit" | "focus" | "sel" | "rec" | "log" | "tick" | "units" | "theme" | "resize";

export interface OptionDef {
  key: string;
  label: string;
  type: "select" | "number" | "toggle" | "multi" | "text";
  def: unknown;
  choices?: (string | [string, string])[];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  /** Kept (saved, sanitised) but not listed in the options dialog: the module has its own panel for it. */
  hidden?: boolean;
}

export interface ToolDef { id: string; label: string; icon: string }

export interface ModuleAction { label: string; fn: () => void }

/** What a module's view hands back to its frame: the header line, an alert level and the body (or a state instead of a body). */
export interface ModuleView {
  /** The header line: a string, or several figures shown side by side. */
  info?: string | ReactNode[];
  /** Extra header content after the title (a segmented switch). */
  headExtra?: ReactNode;
  /** Icon buttons on the right of the header, beside Options and Hide. */
  quick?: ReactNode;
  /** Replaces the module's tools while it shows, for a button whose icon follows a state (pause, then resume). */
  tools?: ToolDef[];
  /** 0 to 2, and how many lines it stands for; feeds the tab badge and marks the module. */
  alert?: [level: number, count?: number];
  /** Shown in place of the body: nothing to show yet ('empty'), or the module cannot work here ('na'). */
  state?: { kind: "empty" | "na"; msg: string; action?: ModuleAction };
  body?: ReactNode;
  /** The body has no padding of its own: the module draws to the edges (tables, cells). */
  flush?: boolean;
  /** Keys pressed while the module has the focus; return true when handled. */
  onKey?: (e: KeyboardEvent) => boolean;
}

export type Opts = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ModuleProps {
  ctx: Ctx;
  opts: Opts;
  /** The instance id, for modules that keep state per instance. */
  id: string;
  /** The module's size on the grid, in columns and rows. */
  size: { w: number; h: number };
}

export interface ModuleDef {
  type: string;
  title: string;
  group: string;
  blurb: string;
  size: { w: number; h: number; minW: number; minH: number };
  multi: boolean;
  needs: Channel[];
  requires: Channel[];
  rate: number;
  options: OptionDef[];
  tools: ToolDef[];
  /** Called as a hook-capable function by the module's host, so it may use hooks. */
  view: (props: ModuleProps) => ModuleView;
  /** A tool button in the header was pressed. */
  tool?: (id: string, props: ModuleProps) => void;
}

export type ModuleSpec = Partial<Omit<ModuleDef, "size">> & Pick<ModuleDef, "type" | "title" | "view"> & { size?: Partial<ModuleDef["size"]> };
