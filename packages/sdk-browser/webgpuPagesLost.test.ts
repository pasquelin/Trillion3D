import test from 'node:test';
import assert from 'node:assert/strict';
import { markWebgpuLost } from './webgpuPagesLost.ts';

test('a lost device withdraws the presented surface and breaks the held frame, once', () => {
  let unconfigured = 0;
  const revisions = { scene: 1, view: 1, resources: 1 };
  const rt = {
    run: {
      lost: false,
      frameHeld: true,
      gate: {
        revisions,
        resourcesChanged: () => {
          revisions.resources++;
        },
      },
    },
    gpu: {
      presenter: {
        canvas: {},
        dispose() {
          unconfigured++;
        },
      },
    },
  };
  assert.equal(markWebgpuLost(rt as never), true, 'the first report is the one to announce');
  assert.equal(rt.run.lost, true);
  assert.equal(rt.gpu.presenter, undefined, 'the canvas of a dead device stays unpublished');
  assert.equal(unconfigured, 1, 'unconfiguring the context blanks the drawing buffer');
  assert.equal(rt.run.frameHeld, false, 'no frame of a lost device is still held');
  assert.equal(revisions.resources, 2, 'the held witness no longer matches the revisions');
  assert.equal(markWebgpuLost(rt as never), false, 'a second cause changes nothing');
  assert.equal(revisions.resources, 2);
  assert.equal(unconfigured, 1);
});
