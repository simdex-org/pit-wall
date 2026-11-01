/** How much of a lap a recorded line covers: the forward steps of its lap fraction, with the jump over the start line counted once. */
export function lapSpan(pts: ArrayLike<number[]>): number {
  let span = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i]![2]! - pts[i - 1]![2]!;
    span += d >= 0 ? d : d < -0.5 ? d + 1 : 0;
  }
  return span;
}
