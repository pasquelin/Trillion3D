// #1097: each view keeps its own held-frame witness. A switch hands the gate the drawn view's hold
// and breaks none: what one view draws never resets another's, while a change of the scene or the
// resources, which every view shows, still reaches all of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameGateCore } from './gateCore.ts';

/** A gate whose drawn view kept two identical frames: its hold is armed. */
function heldGate() {
  const gate = createFrameGateCore(1);
  for (let i = 0; i < 2; i++) gate.hold.keep(gate.revisions);
  assert.equal(gate.held(), true);
  return gate;
}

test('another view drawn, its own hold broken, never resets the main view’s', () => {
  const gate = heldGate();
  const main = gate.useViewHold(undefined);
  assert.equal(gate.held(), false, 'a new view holds nothing yet');
  gate.hold.keep(gate.revisions);
  gate.viewReplaced();
  gate.hold.keep(gate.revisions);
  const side = gate.useViewHold(main);
  assert.equal(gate.held(), true, 'the main view is still held');
  assert.equal(gate.useViewHold(side), main, 'the switch hands back the hold it held');
  assert.equal(gate.held(), false, 'the side view’s own hold stays broken');
});

test('a scene or resource change reaches the hold of every view', () => {
  for (const change of ['sceneChanged', 'resourcesChanged'] as const) {
    const gate = heldGate();
    const main = gate.useViewHold(undefined);
    gate[change]();
    gate.useViewHold(main);
    assert.equal(gate.held(), false, `${change} while another view is drawn`);
  }
});
