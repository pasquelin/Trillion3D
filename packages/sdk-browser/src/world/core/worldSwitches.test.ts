import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MeasuredWorld } from '../session/explorer.ts';
import { sessionOptions } from './worldOptions.ts';
import { worldSwitches } from './worldSwitches.ts';

/** An open session that records the switches written into it. */
function session(draws = true) {
  const written: boolean[] = [];
  let on = draws;
  const explorer = {
    setTemporalAntialiasing: (next: boolean) => void (written.push(next), (on = next)),
    temporalAntialiasing: () => on,
  } as unknown as MeasuredWorld;
  return { explorer, written };
}

// #363: `createWorld(…, { temporalAntialiasing: false })` opens its sessions with it off, and
// the property flips the open session in place, never reopening it.
test('temporal antialiasing is given to the session and switched in place', () => {
  const open = session(false);
  let renewed = 0,
    invalidated = 0;
  const runtime = { explorer: null as MeasuredWorld | null, renew: () => void renewed++ };
  const device = { renderer: 'webgpu' as const };
  const options = { temporalAntialiasing: false };
  const switches = worldSwitches(
    options,
    () => runtime,
    device,
    () => void invalidated++,
  );
  assert.equal(sessionOptions(options, switches.held).temporalAntialiasing, false);
  assert.equal(switches.temporalAntialiasing, false, 'before a session: what the page asked');
  runtime.explorer = open.explorer;
  switches.temporalAntialiasing = true;
  switches.temporalAntialiasing = true;
  assert.deepEqual(open.written, [true], 'written once, into the open session');
  assert.equal(switches.temporalAntialiasing, true, 'read back from the session');
  assert.equal(sessionOptions(options, switches.held).temporalAntialiasing, true, 'kept on reopen');
  assert.deepEqual([renewed, invalidated], [0, 1]);
});

test('temporal antialiasing reads false on WebGL2 and as the session draws it', () => {
  const runtime = { explorer: null as MeasuredWorld | null, renew() {} };
  const switches = worldSwitches(
    {},
    () => runtime,
    { renderer: 'webgl2' },
    () => {},
  );
  assert.equal(switches.held.temporalAntialiasing, true, 'on by default');
  assert.equal(switches.temporalAntialiasing, false, 'WebGL2 has none');
  runtime.explorer = session(false).explorer;
  assert.equal(switches.temporalAntialiasing, false);
});
