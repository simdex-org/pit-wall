// Named shared memory, the way ACC publishes its pages. Windows only.
import koffi from "koffi";

const k32 = koffi.load("kernel32.dll");
const CreateFileMappingW = k32.func("void * __stdcall CreateFileMappingW(intptr_t file, void *attrs, uint32 protect, uint32 hi, uint32 lo, str16 name)");
const MapViewOfFile = k32.func("void * __stdcall MapViewOfFile(void *h, uint32 access, uint32 hi, uint32 lo, size_t bytes)");

const PAGE_READWRITE = 0x04;
const FILE_MAP_WRITE = 0x02;

/**
 * Open (or create) the mapping `name` and return a function that copies its current bytes.
 * Mapped writable like every ACC reader: started before ACC, this creates the mapping ACC then opens. Nothing is written.
 */
export function openShared(name: string, size: number): () => Buffer {
  const h = CreateFileMappingW(-1, null, PAGE_READWRITE, 0, size, name); // INVALID_HANDLE_VALUE: backed by the page file
  if (!h) throw new Error(`cannot open shared memory ${name}`);
  const p = MapViewOfFile(h, FILE_MAP_WRITE, 0, 0, size);
  if (!p) throw new Error(`cannot map shared memory ${name}`);
  const view = koffi.view(p, size);
  return () => Buffer.from(view.slice(0));
}
