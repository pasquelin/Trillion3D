/** Fixed simulation cadence. Wall-clock stalls cannot trigger an unbounded catch-up burst. */
export function fixedClock(rate: number, maxSteps = 4) {
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isSafeInteger(maxSteps) || maxSteps < 1)
    throw new RangeError('Invalid fixed-clock limits');
  const dt = 1 / rate;
  let pending = 0;
  let dropped = 0;
  return {
    dt,
    advance(elapsed: number) {
      if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError('Invalid elapsed time');
      pending += elapsed;
      const due = Math.floor((pending + dt * 1e-9) / dt);
      const taken = Math.min(due, maxSteps);
      pending = Math.max(0, pending - due * dt);
      dropped += due - taken;
      return taken;
    },
    get dropped() {
      return dropped;
    },
  };
}
