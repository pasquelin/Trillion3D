// Shadow pages follow the shading's report (#1209): a frame's plan maps and draws what the
// latest readback named, never pages bounded by the boxes of the clusters it draws — a ring
// round a lamp bounds the lamp's whole map. A page no report named yet reads the next coarser
// level, as it did before #1231, and none other: no page a receiver reads is dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAMP } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { SHADOW_WGSL } from '../../lighting/direct/shadowBias.fixture.ts';
import { READ, type Lit } from './shadingReads.fixture.ts';
import { cameraAt, readable, reportScene } from './reportScene.fixture.ts';

test('the shading read the scheduling is proved against is the WGSL one', () => {
  for (const line of READ) assert.ok(SHADOW_WGSL.includes(line), line);
});

/** `spin-an-astrolabe`: a ring of radius 2.2 m round a still lamp, its two halves' boxes each
 *  holding the lamp, and the points of its inner side the shading lights. */
const AT: [number, number, number] = [0, 3, -12],
  R = 2.2;
const ring = {
  boxes: [
    [AT[0] - R, AT[1], AT[2] - 0.05, AT[0] + R, AT[1] + R, AT[2] + 0.05],
    [AT[0] - R, AT[1] - R, AT[2] - 0.05, AT[0] + R, AT[1], AT[2] + 0.05],
  ],
  lits: Array.from({ length: 360 }, (_, i): Lit => {
    const a = (i / 360) * 2 * Math.PI;
    return {
      P: [AT[0] + R * Math.cos(a), AT[1] + R * Math.sin(a), AT[2]],
      N: [-Math.cos(a), -Math.sin(a), 0],
    };
  }),
};

test('a caster turning round a still lamp requests the pages the shading read, as before #1231', () => {
  // The astrolabe's pool, 71² pages; the camera 5.6 m off the ring.
  const scene = reportScene(71, [{ ...LAMP, position: AT, range: 10 }], ring.boxes),
    cam = cameraAt([0, 3, -6.4], [0, 0, -1]);
  let reads = scene.frame(1, cam, [], ring.lits);
  for (let frame = 2; frame < 8; frame++) {
    const x = AT[0] + R * Math.cos(frame / 4),
      y = AT[1] + R * Math.sin(frame / 4);
    scene.plan.worldChanged([x - 0.1, y - 0.1, AT[2] - 0.1], [x + 0.1, y + 0.1, AT[2] + 0.1]);
    const reported = reads;
    reads = scene.frame(frame, cam, reported, ring.lits);
    // Before #1231 the report alone was requested: what the shading of the frame before read.
    assert.equal(scene.plan.requests.counts.requested, reported.length, `requested at ${frame}`);
    for (const entry of reads) assert.ok(readable(scene.plan, entry), `entry ${entry} at ${frame}`);
  }
});
