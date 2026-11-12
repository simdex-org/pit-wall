import koffi from "koffi";

const k32 = koffi.load("kernel32.dll");
const CreateFileMappingW = k32.func("void * __stdcall CreateFileMappingW(intptr_t file, void *attrs, uint32 protect, uint32 hi, uint32 lo, str16 name)");
const MapViewOfFile = k32.func("void * __stdcall MapViewOfFile(void *h, uint32 access, uint32 hi, uint32 lo, size_t bytes)");

const OpenFileMappingW = k32.func("void * __stdcall OpenFileMappingW(uint32 access, int inherit, str16 name)");
const CloseHandle = k32.func("int __stdcall CloseHandle(void *h)");

const PAGE_READWRITE = 0x04;
const FILE_MAP_WRITE = 0x02;
const FILE_MAP_READ = 0x04;

// Opens a mapping only once the game has made it, so a newer, bigger one from a game update is never blocked by ours.
// Reads null until then.
export function openExisting(name: string, size: number): () => Buffer | null {
  let view: ArrayBuffer | null = null;
  return () => {
    if (!view) {
      const h = OpenFileMappingW(FILE_MAP_READ, 0, name);
      if (!h) return null;
      const p = MapViewOfFile(h, FILE_MAP_READ, 0, 0, size);
      if (!p) { CloseHandle(h); return null; }
      view = koffi.view(p, size);
    }
    return Buffer.from(view.slice(0));
  };
}

export function openShared(name: string, size: number): () => Buffer {
  const h = CreateFileMappingW(-1, null, PAGE_READWRITE, 0, size, name);
  if (!h) throw new Error(`cannot open shared memory ${name}`);
  const p = MapViewOfFile(h, FILE_MAP_WRITE, 0, 0, size);
  if (!p) throw new Error(`cannot map shared memory ${name}`);
  const view = koffi.view(p, size);
  return () => Buffer.from(view.slice(0));
}
