import { addressFlag } from './addressFlag.ts';
import { families } from './families.ts';

/** Whether a world or the page turned the debug mode on (`setDebugMode`). */
let asked = false;
/** Whether the page's address carries `?profile`, read as the examples' profile reads it. */
const profileAsked = addressFlag((params) => params.has('profile'));

/**
 * The engine's debug mode (#1353), a development build's tools against a shipping build: the
 * frames are filed into the CPU step profile (`world.cpuSteps`) and the frame report
 * (`getReport`) only in it, and the measurement's code (`families.measurement`) — the frame
 * report's and the pass table's — is fetched only once it turns on, or by what reads it — a
 * listened diagnostic channel, the frame audit, an A/B layout, the pass mapping. A page that
 * never asks for it — a world's `debug` option or setter, the examples' stats corner, `?profile`
 * in its address — files no frame into a profile. It is the page's: every world reads it.
 */
export function debugMode() {
  return asked || profileAsked();
}

/** Turns the page's debug mode on or off, from the next frame; on, fetches the debug code. */
export function setDebugMode(on: boolean) {
  asked = on;
  if (on) families.measurement.get();
}
