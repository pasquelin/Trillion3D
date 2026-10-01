import assert from 'node:assert/strict';
import test from 'node:test';
import { stats } from './stats.ts';
import type { StatsWorld } from './statsLines.ts';

/** Just enough of an element for the kit's overlay and its stats card. */
const element = () => ({
  dataset: {},
  style: {},
  hidden: false,
  className: '',
  append() {},
  replaceChildren() {},
  removeAttribute() {},
  attachShadow: () => ({ append() {} }),
});

test("the stats corner turns the engine's debug mode on, which its CPU steps need", () => {
  Object.assign(globalThis, { document: { createElement: element, body: element() } });
  const world = {
    diagnostic: { debug: false },
    onFrame: () => () => {},
    scene: {},
  } as unknown as StatsWorld & { diagnostic: { debug: boolean } };
  const stop = stats(world);
  try {
    assert.equal(world.diagnostic.debug, true);
  } finally {
    stop();
    Reflect.deleteProperty(globalThis, 'document');
  }
});
