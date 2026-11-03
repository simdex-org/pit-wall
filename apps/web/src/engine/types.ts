import type { KeyboardEvent, ReactNode } from "react";
import type { Ctx } from "../feed/store";

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
  hidden?: boolean;
}

export interface ToolDef { id: string; label: string; icon: string }

export interface ModuleAction { label: string; fn: () => void }

export interface ModuleView {
  info?: string | ReactNode[];
  headExtra?: ReactNode;
  quick?: ReactNode;
  tools?: ToolDef[];
  alert?: [level: number, count?: number];
  state?: { kind: "empty" | "na"; msg: string; action?: ModuleAction };
  body?: ReactNode;
  flush?: boolean;
  onKey?: (e: KeyboardEvent) => boolean;
}

export type Opts = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ModuleProps {
  ctx: Ctx;
  opts: Opts;
  id: string;
  size: { w: number; h: number };
}

export interface ModuleDef {
  type: string;
  title: string;
  group: string;
  blurb: string;
  size: { w: number; h: number; minW: number; minH: number; maxW?: number; maxH?: number };
  multi: boolean;
  needs: Channel[];
  requires: Channel[];
  rate: number;
  options: OptionDef[];
  tools: ToolDef[];
  view: (props: ModuleProps) => ModuleView;
  tool?: (id: string, props: ModuleProps) => void;
}

export type ModuleSpec = Partial<Omit<ModuleDef, "size">> & Pick<ModuleDef, "type" | "title" | "view"> & { size?: Partial<ModuleDef["size"]> };
