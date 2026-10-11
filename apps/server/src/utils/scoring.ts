/**
 * The one place time turns into points.
 *
 * Every timed mode scores the same shape: answer instantly and you get `max`, answer at or after
 * `window` and you get `min`, and in between it falls off linearly. Modes differ in their
 * constants and in what they add on top (the speed mode adds a bonus for answering first), not in
 * the curve, so the curve lives here rather than being re-derived per mode.
 *
 * `elapsed` and `window` must share a unit; the caller picks seconds or milliseconds.
 */
export function timeDecayScore(opts: {
  elapsed: number;
  window: number;
  max: number;
  min: number;
}): number {
  const { elapsed, window, max, min } = opts;

  // A zero or negative window means there was no time to answer in, so nothing can be "fast".
  if (window <= 0) return min;

  // Clamped at both ends on purpose. Past the window scores the floor rather than running down
  // past it, and a negative elapsed (clock skew, a client sending nonsense) scores the ceiling
  // rather than something above it.
  const fraction = Math.min(1, Math.max(0, elapsed) / window);

  // `min` above `max` is reachable, not hypothetical: the admin settings for the speed mode allow
  // max in 10..500 and min in 0..200 with no cross-check, so an admin can invert them. Flooring
  // the span at zero makes that degrade to a flat `max` instead of a curve that climbs with time.
  const span = Math.max(0, max - min);
  return Math.round(max - span * fraction);
}
