import {
  Activity, ChevronDown, CircleCheck, Cloud, CloudDrizzle, CloudLightning, CloudRain, Copy, Crosshair, Disc, Droplets, Eye, EyeOff, Flame, GripVertical, PanelRight, Tag, Inbox, Info, Keyboard, LayoutDashboard, Lock, Maximize,
  Gauge, OctagonAlert, Pause, Play, Plus, Redo2, Settings, SlidersHorizontal, Sun, SquareParking, TriangleAlert, Undo2, Unplug, Users, Wrench, X,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  activity: Activity, disc: Disc, gauge: Gauge, "square-parking": SquareParking, wrench: Wrench, "chevron-down": ChevronDown, "circle-check": CircleCheck, cloud: Cloud, "cloud-drizzle": CloudDrizzle, "cloud-lightning": CloudLightning, "cloud-rain": CloudRain, sun: Sun, copy: Copy, crosshair: Crosshair, droplets: Droplets, eye: Eye, "eye-off": EyeOff,
  flame: Flame, "panel-right": PanelRight, tag: Tag, "grip-vertical": GripVertical, inbox: Inbox, info: Info, keyboard: Keyboard, "layout-dashboard": LayoutDashboard, lock: Lock,
  maximize: Maximize, "octagon-alert": OctagonAlert, pause: Pause, play: Play, plus: Plus, "redo-2": Redo2, settings: Settings,
  "sliders-horizontal": SlidersHorizontal, "triangle-alert": TriangleAlert, "undo-2": Undo2, unplug: Unplug, users: Users, x: X,
};

/** A Lucide icon by name; modules name their tool icons as strings. */
export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const Glyph = ICONS[name];
  return Glyph ? <Glyph className="lucide" width={size} height={size} strokeWidth={1.75} aria-hidden /> : null;
}
