/** Hands the browser a JSON file to save. */
export function download(name: string, obj: unknown): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([typeof obj === "string" ? obj : JSON.stringify(obj, null, 1)], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
