// Shared by the GT3 model (car3d2.ts) and its view: the triangle builders, the colouring by damage and the WebGL canvas. Every triangle
// names its part, so each part is painted by the damage ACC reports for it: the five body zones (front, rear, left, right, centre),
// each corner's suspension (s0..s3, FL FR RL RR) and brake pads (b0..b3); the glass, tyres and cabin are drawn neutral, since ACC
// says nothing about them.
// Frame: metres, x forward (nose +), y to the car's left, z up.
import type * as THREE from "three";
import { Tokens, tokens } from "./canvas";

type T3 = typeof THREE;
type V3 = [number, number, number];
export type Layer = "shell" | "inner" | "glass" | "frame";
type PartFn = (x: number, y: number, z: number) => string;
export interface LayerData { pos: number[]; nor: number[]; part: string[]; kind: string[] }

const rgbOf = (s: string): number[] => (s.match(/\d+(\.\d+)?/g) ?? [0, 0, 0]).slice(0, 3).map(Number);

/** Level 0..1 as --ok, --warn, --bad in between. */
export function levelColour(t: number, tk: Pick<Tokens, "ok" | "warn" | "bad">): number[] {
  const a = rgbOf(tk.ok), b = rgbOf(tk.warn), c = rgbOf(tk.bad), u = Math.max(0, Math.min(1, t));
  const [p, q, f] = u < 0.5 ? [a, b, u * 2] : [b, c, (u - 0.5) * 2];
  return p!.map((v, i) => v + (q![i]! - v) * f!);
}

/** Where each part's figure sits on the car, and the way that surface faces. */
export const ANCHOR: Record<string, [V3, V3]> = {
  front: [[2.5, 0, 0.4], [1, 0, 0]], rear: [[-2.5, 0, 0.95], [-1, 0, 0]], left: [[-0.3, 1.05, 0.55], [0, 1, 0]], right: [[-0.3, -1.05, 0.55], [0, -1, 0]],
  centre: [[-0.2, 0, 1.3], [0, 0, 1]], s0: [[1.36, 1.08, 0.34], [0.5, 0.85, 0]], s1: [[1.36, -1.08, 0.34], [0.5, -0.85, 0]], s2: [[-1.32, 1.08, 0.34], [-0.5, 0.85, 0]],
  s3: [[-1.32, -1.08, 0.34], [-0.5, -0.85, 0]],
};
export const VIEWS: Record<string, [az: number, el: number]> = {
  iso: [0.75, 0.34], top: [Math.PI, 1.5707], front: [0, 0.08], rear: [Math.PI, 0.08], left: [Math.PI / 2, 0.06], right: [-Math.PI / 2, 0.06],
};

export interface CarModel {
  group: THREE.Group;
  meshes: Record<Layer, THREE.Mesh>;
  mats: Record<Layer, THREE.Material>;
  /** lv: part to level 0..1 or null; xray: the bodywork see-through. */
  update(lv: Record<string, number | null>, tk: Tokens, xray: boolean): void;
}

/** The triangle builders the car models share: every shape ends up as triangles in one of four layers, each naming its part. */
export function makeKit(T: T3) {
  const layers = {} as Record<Layer, LayerData>;
  for (const k of ["shell", "inner", "glass", "frame"] as Layer[]) layers[k] = { pos: [], nor: [], part: [], kind: [] };
  const tri = (layer: Layer, a: number[], b: number[], c: number[], na: number[], nb: number[], nc: number[], part: string | PartFn, kind: string) => {
    const o = layers[layer];
    o.pos.push(...a, ...b, ...c);
    o.nor.push(...na, ...nb, ...nc);
    o.part.push(typeof part === "function" ? part((a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3, (a[2]! + b[2]! + c[2]!) / 3) : part);
    o.kind.push(kind);
  };
  /** Any three.js geometry, placed by a matrix, into a layer. */
  const geo = (layer: Layer, g0: THREE.BufferGeometry, m: THREE.Matrix4 | null, part: string, kind: string) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (m) g.applyMatrix4(m);
    g.computeVertexNormals();
    const p = g.attributes.position!.array, n = g.attributes.normal!.array;
    for (let i = 0; i < p.length; i += 9) {
      tri(layer, [p[i]!, p[i + 1]!, p[i + 2]!], [p[i + 3]!, p[i + 4]!, p[i + 5]!], [p[i + 6]!, p[i + 7]!, p[i + 8]!], [n[i]!, n[i + 1]!, n[i + 2]!], [n[i + 3]!, n[i + 4]!, n[i + 5]!], [n[i + 6]!, n[i + 7]!, n[i + 8]!], part, kind);
    }
    g.dispose();
  };
  const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, "ZYX")), new T.Vector3(sx, sy, sz));
  const box = (layer: Layer, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, part: string, kind: string) =>
    geo(layer, new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), part, kind);
  const v3 = (a: number[]) => new T.Vector3(a[0], a[1], a[2]);
  const rod = (layer: Layer, a: number[], b: number[], r: number, part: string, kind: string) => { // a cylinder from a to b
    const A = v3(a), B = v3(b), d = B.clone().sub(A), g = new T.CylinderGeometry(r, r, d.length(), 8, 1);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize()));
    const mid = A.clone().add(B).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    geo(layer, g, null, part, kind);
  };
  const tube = (layer: Layer, pts: number[][], r: number, closed: boolean, part: string, kind: string) =>
    geo(layer, new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(v3), closed), pts.length * 4, r, 6, closed), null, part, kind);
  /** A flat shape drawn in the x-z plane (u = x, v = z), extruded `depth` towards -y from y0 + depth. */
  const plate = (layer: Layer, pts: number[][], y0: number, depth: number, part: string, kind: string) => {
    const g = new T.ExtrudeGeometry(new T.Shape(pts.map(([u, v]) => new T.Vector2(u, v))), { depth, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(Math.PI / 2);
    g.translate(0, y0 + depth, 0);
    geo(layer, g, null, part, kind);
  };
  /** A flat shape drawn in the x-y plane, extruded `depth` up from z0. */
  const flat = (layer: Layer, pts: number[][], z0: number, depth: number, part: string, kind: string) => {
    const g = new T.ExtrudeGeometry(new T.Shape(pts.map(([u, v]) => new T.Vector2(u, v))), { depth, bevelEnabled: false });
    g.translate(0, 0, z0);
    geo(layer, g, null, part, kind);
  };
  const quadN = (a: number[], b: number[], c: number[]) => {
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!], l = Math.hypot(...n) || 1;
    return n.map((e) => e / l);
  };
  const quad = (layer: Layer, a: number[], b: number[], c: number[], d: number[], part: string | PartFn, kind: string) => {
    const n = quadN(a, b, c);
    tri(layer, a, b, c, n, n, n, part, kind);
    tri(layer, a, c, d, n, n, n, part, kind);
  };
  const both = (fn: (s: number) => void) => { fn(1); fn(-1); };
  const sideOf = (s: number) => (s > 0 ? "left" : "right");
  return { layers, tri, geo, M, box, v3, rod, tube, plate, flat, quad, both, sideOf };
}
export type Kit = ReturnType<typeof makeKit>;

/** Turns the layers into three.js meshes and the colouring by damage level. the paint is matt and the damage zones blend into each other; `arches` are the wheel arch openings [x, ...] cut out of the shell on the GPU. */
export function assemble(T: T3, layers: Record<Layer, LayerData>, arches: number[]): CarModel {
  // ---- into three.js: one mesh per layer, colours per triangle ----
  const mats = {
    shell: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: T.DoubleSide }),
    inner: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, side: T.DoubleSide }),
    glass: new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.82, side: T.DoubleSide, depthWrite: false }),
    frame: new T.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, side: T.DoubleSide }),
  };
  { // the wheel arch openings are cut per pixel, so their edge is a true circle whatever the mesh looks like
    const test = arches.map((x) => `length(vec2(vP.x - ${x.toFixed(3)}, vP.z - 0.345)) < 0.352`).join(" || ");
    const wide = arches.map((x) => `length(vec2(vP.x - ${x.toFixed(3)}, vP.z - 0.345)) < 0.5`).join(" || "); // the inside faces of the arch only: the canopy and the rest of the body are lit from both sides
    mats.shell.onBeforeCompile = (sh) => {
      const decl = "#include <common>\nvarying vec3 vP;";
      sh.vertexShader = sh.vertexShader.replace("#include <common>", decl).replace("#include <begin_vertex>", "#include <begin_vertex>\nvP = position;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", decl).replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\nif (abs(vP.y) > 0.6 && vP.z < 0.62 && (abs(vP.y) > 0.82 || vP.z < 0.3) && (${test})) discard;`).replace("#include <color_fragment>", `#include <color_fragment>\nif (!gl_FrontFacing && abs(vP.y) > 0.5 && vP.z < 0.8 && (${wide})) diffuseColor.rgb *= 0.1;`);
    };
  }
  const meshes = {} as Record<Layer, THREE.Mesh>;
  for (const k of ["shell", "inner", "glass", "frame"] as Layer[]) {
    const o = layers[k], g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(o.pos, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(o.nor, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(new Float32Array(o.pos.length).fill(1), 3));
    meshes[k] = new T.Mesh(g, mats[k]);
    meshes[k].renderOrder = k === "glass" ? 2 : 1;
  }
  { // smoked glass, lighter toward the top and the middle of the cabin, so a window reads as glass and not as a black hole
    const o = layers.glass, col = meshes.glass.geometry.attributes.color!, a = col.array as Float32Array, c = new T.Color();
    for (let i = 0; i < o.pos.length; i += 3) {
      const x = o.pos[i]!, z = o.pos[i + 2]!, k = Math.pow(Math.min(1, Math.max(0, (z - 0.55) / 0.65)), 2), f = Math.max(0, 1 - Math.abs(x + 0.1) / 1.5), m = 0.12 + 0.75 * k * f;
      c.setRGB(0.07 + 0.25 * m, 0.09 + 0.31 * m, 0.12 + 0.36 * m, T.SRGBColorSpace);
      a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b;
    }
    col.needsUpdate = true;
  }
  const group = new T.Group();
  for (const k of ["inner", "shell", "frame", "glass"] as Layer[]) group.add(meshes[k]);
  let key = "";
  return {
    group, meshes, mats,
    update(lv, tk, xray) {
      const k2 = JSON.stringify([lv, tk.ok, tk.warn, tk.bad, tk.raise, tk.bg, xray]);
      if (k2 === key) return;
      key = k2;
      const lin = (rgb: number[]) => new T.Color().setRGB(rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255, T.SRGBColorSpace);
      const base = rgbOf(tk.raise), dark = rgbOf(tk.bg);
      const cache: Record<string, THREE.Color> = {};
      const shade = (c: number[], kind: string): number[] => {
        if (kind === "carbon") return c.map((v, i) => v * 0.5 + base[i]! * 0.5);
        if (kind === "vent") return c.map((v, i) => v * 0.18 + dark[i]! * 0.82);
        if (kind === "light") return c.map((v) => v + (255 - v) * 0.4);
        if (kind === "rim") return c.map((v) => v * 0.85);
        if (kind === "liner") return c.map((v) => v * 0.3);
        return c;
      };
      const colourOf = (part: string, kind: string): THREE.Color => {
        const id = part + "|" + kind;
        if (cache[id]) return cache[id]!;
        const t = lv[part];
        let c: number[];
        if (kind === "tyre") c = [26, 28, 31];
        else if (kind === "well") c = [5, 6, 7];
        else if (kind === "neutral" || t == null) c = [128, 133, 140];
        else c = shade(levelColour(t, tk), kind);
        return (cache[id] = lin(c));
      };
      const sm = (a: number, b: number, v: number) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
      const zoneRgb: Record<string, number[]> = {};
      for (const z of ["front", "rear", "left", "right", "centre"]) zoneRgb[z] = lv[z] == null ? [128, 133, 140] : levelColour(lv[z]!, tk);
      const blended = (x: number, y: number, z: number, kind: string): THREE.Color => { // the zones melt into each other over a short stretch, and the low bodywork sits in shade
        const sf = sm(1.2, 1.4, x), sr = sm(-1.25, -1.45, x), R = (1 - sf) * (1 - sr), sa = sm(0.54, 0.7, Math.abs(y)) * R;
        const w: Record<string, number> = { front: sf, rear: (1 - sf) * sr, left: y > 0 ? sa : 0, right: y > 0 ? 0 : sa, centre: R - sa };
        const c = [0, 0, 0];
        for (const k in w) for (let i = 0; i < 3; i++) c[i]! += zoneRgb[k]![i]! * w[k]!;
        const ao = 0.62 + 0.38 * sm(0.06, 0.55, z);
        return lin(shade(c, kind).map((v) => v * ao));
      };
      for (const k of ["shell", "inner"] as const) {
        const o = layers[k], col = meshes[k].geometry.attributes.color!, a = col.array as Float32Array;
        for (let t = 0; t < o.part.length; t++) {
          const part = o.part[t]!, soft = k === "shell" && lv[part] !== undefined && o.kind[t] !== "well" && !/^[sb]\d$/.test(part);
          for (let v = 0; v < 3; v++) {
            const c = soft ? blended(o.pos[9 * t + 3 * v]!, o.pos[9 * t + 3 * v + 1]!, o.pos[9 * t + 3 * v + 2]!, o.kind[t]!) : colourOf(part, o.kind[t]!);
            a[9 * t + 3 * v] = c.r; a[9 * t + 3 * v + 1] = c.g; a[9 * t + 3 * v + 2] = c.b;
          }
        }
        col.needsUpdate = true;
      }
      mats.shell.transparent = xray; mats.shell.opacity = xray ? 0.16 : 1; mats.shell.depthWrite = !xray; mats.shell.needsUpdate = true;
      mats.glass.opacity = xray ? 0.12 : 0.88; mats.frame.transparent = xray; mats.frame.opacity = xray ? 0.3 : 1; mats.frame.needsUpdate = true;
    },
  };
}

export interface CarView {
  /** Draws the car and returns the label anchors: part to [x, y, facing the camera]. */
  draw(view: { az: number; el: number; x: boolean; zoom: number }, lv: Record<string, number | null>): Record<string, [number, number, boolean]>;
  dispose(): void;
}

let threeP: Promise<T3> | null = null;
const loadThree = () => (threeP ??= import("three"));

/** The car in a WebGL canvas of its own inside host. Rejects when three.js cannot load or there is no WebGL. */
export async function car3dView(host: HTMLElement): Promise<CarView> {
  const T = await loadThree();
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.domElement.className = "c3-gl";
  host.prepend(renderer.domElement);
  const scene = new T.Scene(), car = (await import("./car3d2")).buildCar2(T), cam = new T.PerspectiveCamera(28, 1, 0.1, 100);
  scene.add(car.group);
  { // a contact shadow under the car
    const cv = document.createElement("canvas"); cv.width = cv.height = 128;
    const g = cv.getContext("2d")!, gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const shadow = new T.Mesh(new T.PlaneGeometry(6.4, 3.4), new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), transparent: true, depthWrite: false }));
    shadow.position.z = 0.002;
    scene.add(shadow);
  }
  scene.add(new T.HemisphereLight(0xffffff, 0x2a2d33, 2.2));
  const sun = new T.DirectionalLight(0xffffff, 1.8); sun.position.set(4, 5, 7); scene.add(sun);
  const rim = new T.DirectionalLight(0xffffff, 0.7); rim.position.set(-5, -4, 3); scene.add(rim);
  const centre = new T.Vector3(0, 0, 0.62), BOX: number[][] = []; // what the camera looks at, and the corners of the car's box
  for (const x of [-2.8, 2.55]) for (const y of [-1.1, 1.1]) for (const z of [0, 1.33]) BOX.push([x, y, z - 0.62]);
  const dot = (p: number[], q: number[]) => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
  return {
    draw(view, lv) {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return {};
      renderer.setSize(w, h, false);
      car.update(lv, tokens(), view.x);
      const ca = Math.cos(view.az), sa = Math.sin(view.az), ce = Math.cos(view.el), se = Math.sin(view.el), a = w / h, f = (cam.fov * Math.PI) / 360;
      const d = [ce * ca, ce * sa, se], r = [-sa, ca, 0], u = [-se * ca, -se * sa, ce];
      let dist = 0; // far enough that every corner of the box is inside the view, with a margin
      for (const p of BOX) { const z = dot(p, d); dist = Math.max(dist, z + (Math.abs(dot(p, r)) / (Math.tan(f) * a)) * 1.08, z + (Math.abs(dot(p, u)) / Math.tan(f)) * 1.12); }
      dist *= view.zoom;
      cam.aspect = a;
      cam.up.set(u[0]!, u[1]!, u[2]!); // the orbit's own up: never parallel to the view, so Top works
      cam.position.set(centre.x + dist * ce * ca, centre.y + dist * ce * sa, centre.z + dist * se);
      cam.lookAt(centre);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      const out: Record<string, [number, number, boolean]> = {};
      for (const [part, [p, n]] of Object.entries(ANCHOR)) {
        const v = new T.Vector3(p[0], p[1], p[2]).project(cam);
        const facing = n[0] * d[0]! + n[1] * d[1]! + n[2] * d[2]! > 0.2 || view.el > 1.2 || part === "centre";
        out[part] = [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h, facing];
      }
      return out;
    },
    dispose() {
      renderer.dispose();
      for (const k of Object.keys(car.meshes) as Layer[]) { car.meshes[k].geometry.dispose(); car.mats[k].dispose(); }
      renderer.domElement.remove();
    },
  };
}
