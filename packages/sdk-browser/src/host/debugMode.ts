/** Whether a world or the page turned the debug mode on (`setDebugMode`). */
let asked = false;
/** The address read last, and whether it asked for `?profile`: parsed once per string. */
let search: string | undefined,
  profiled = false;

/** Whether the page's address carries `?profile`, read as the examples' profile reads it. */
function profileAsked() {
  const now = typeof location === 'undefined' ? undefined : location.search;
  if (now !== search) {
    search = now;
    profiled = now !== undefined && new URLSearchParams(now).has('profile');
  }
  return profiled;
}

/**
 * The engine's debug mode (#1353), a development build's tools against a shipping build: the
 * frames are filed into the CPU step profile (`world.cpuSteps`) and the frame report
 * (`getReport`) only in it, and the measurement's code (`families.measurement`) is fetched only
 * by what reads it — a listened diagnostic channel, the frame audit, an A/B layout. A page that
 * never asks for it — a world's `debug` option or setter, the examples' stats corner, `?profile`
 * in its address — files no frame into a profile. It is the page's: every world reads it.
 */
export function debugMode() {
  return asked || profileAsked();
}

/** Turns the page's debug mode on or off, from the next frame. */
export function setDebugMode(on: boolean) {
  asked = on;
}
