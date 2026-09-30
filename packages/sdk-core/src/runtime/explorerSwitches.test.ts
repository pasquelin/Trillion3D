import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPLORER_SWITCHES, explorerSwitch, type ExplorerSwitch } from './explorerSwitches.ts';

test('only the boolean opposite to its default moves a switch; anything else keeps the default', () => {
  for (const key of Object.keys(EXPLORER_SWITCHES) as ExplorerSwitch[]) {
    const fallback = explorerSwitch({}, key);
    assert.equal(explorerSwitch({ [key]: fallback }, key), fallback, key);
    assert.equal(explorerSwitch({ [key]: !fallback }, key), !fallback, key);
    for (const loose of [null, 0, 1, '', 'yes'])
      assert.equal(explorerSwitch({ [key]: loose as never }, key), fallback, `${key}: ${loose}`);
  }
});
