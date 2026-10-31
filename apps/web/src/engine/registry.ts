import type { ModuleDef, ModuleSpec } from "./types";

export const registry = new Map<string, ModuleDef>();

/** Fills a module's defaults and adds it to the registry. */
export function defineModule(spec: ModuleSpec): ModuleDef {
  if (!/^[a-z][a-z0-9-]{1,23}$/.test(spec.type)) throw new Error(`bad module type ${spec.type}`);
  if (registry.has(spec.type)) throw new Error(`duplicate module type ${spec.type}`);
  const def: ModuleDef = {
    multi: true, needs: [], requires: [], rate: 10, options: [], tools: [], group: "Other", blurb: "",
    ...spec,
    size: { w: 4, h: 6, minW: 2, minH: 2, ...spec.size },
  };
  registry.set(def.type, def);
  return def;
}
