import assert from 'node:assert/strict';
import test from 'node:test';
import { explorerSwitch } from './explorerSwitches.ts';
import { EXPLORER_SWITCH_NAMES } from './explorerSwitches.fixture.ts';

test('a switch keeps its default when left out, and the boolean opposite to it moves it', () => {
  for (const key of EXPLORER_SWITCH_NAMES) {
    const fallback = explorerSwitch({}, key);
    for (const same of [undefined, null, fallback])
      assert.equal(explorerSwitch({ [key]: same as never }, key), fallback, `${key}: ${same}`);
    assert.equal(explorerSwitch({ [key]: !fallback }, key), !fallback, key);
  }
});

test('a non-boolean value reads as the engine always read it', () => {
  // On by default: only `false` turns it off.
  assert.equal(explorerSwitch({ temporalAntialiasing: 0 as never }, 'temporalAntialiasing'), true);
  // Off by default and strict: only `true` turns it on.
  assert.equal(explorerSwitch({ bounce: 'yes' as never }, 'bounce'), false);
  // Off by default, read as truthy since before this owner existed.
  assert.equal(explorerSwitch({ interactive: 1 as never }, 'interactive'), true);
  assert.equal(explorerSwitch({ lodAdaptive: 1 as never }, 'lodAdaptive'), true);
});
