/** What to tell the driver when the bridge exited without serving. */
export function failureMessage(lines: string[], ip: string, port: string): string {
  const log = lines.join("\n");
  if (/EADDRNOTAVAIL/.test(log)) return `This PC does not have the address ${ip.trim()}. If you changed network or turned off the adapter that uses it, pick another address below.`;
  if (/EADDRINUSE/.test(log)) return `Port ${port.trim()} is already in use. Close the other Pit Wall, or pick another port below.`;
  if (/EACCES/.test(log)) return `Windows does not allow port ${port.trim()}. Pick another port below.`;
  return "Pit Wall could not run. The last lines of the log say why.";
}
