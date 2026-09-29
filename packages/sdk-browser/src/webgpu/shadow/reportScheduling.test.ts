// Shadow pages follow the shading's report (#1209): a frame's plan maps and draws what the
// latest readback named, never pages bounded by the boxes of the clusters it draws — a ring
// round a lamp bounds the lamp's whole map. A page no report named yet reads the next coarser
// level, as it did before #1231, and none other: no page a receiver reads is dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneLight } from '../../../../sdk-core/src/index.ts';
import { LAMP_MIPS } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import {
  decodeLampEntry,
  lampEntry,
} from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { LAMP } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { SHADOW_WGSL } from '../../lighting/direct/shadowBias.fixture.ts';
import { READ, floorTiles, tileGrid, type Lit } from './shadingReads.fixture.ts';
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

/** The coarser pages the shader falls back on for lamp entry `entry` of the light at `base`. */
function coarser(entry: number, base: number) {
  const at = decodeLampEntry(entry - base, new Int32Array(4)),
    up: number[] = [];
  for (
    let mip = at[1] + 1, x = at[2] >> 1, y = at[3] >> 1;
    mip < LAMP_MIPS;
    mip++, x >>= 1, y >>= 1
  )
    up.push(base + lampEntry(at[0], mip, x, y));
  return up;
}

test('under a still lamp, a camera moving closer leaves no hole the report path did not', () => {
  const lamp: SceneLight = { ...LAMP, position: AT },
    tiles = floorTiles(tileGrid(-4, 4, -16, -8), 9),
    scene = reportScene(71, [lamp], tiles.boxes);
  let reads: number[] = [];
  for (let frame = 1; frame < 14; frame++) {
    // The camera comes half a metre closer each frame: its pixels read finer mips than the
    // report of the frame before named.
    const reported = new Set(reads),
      cam = cameraAt([0, 3, 4 - frame * 0.5], [0, -0.3, -0.954]);
    reads = scene.frame(frame, cam, [...reported], tiles.lits);
    const base = scene.plan.table.baseOf(scene.store.sliceOf(0));
    assert.ok(reads.length > 0);
    for (const entry of reads) {
      if (readable(scene.plan, entry)) continue;
      // A hole is a page no report named yet, the one the report path left before #1231…
      assert.ok(!reported.has(entry), `entry ${entry} was reported, drawn at ${frame}`);
      // …and the pixel reads a coarser page drawn: nothing it reads is lost.
      assert.ok(
        coarser(entry, base).some((up) => readable(scene.plan, up)),
        `entry ${entry} has a coarser page drawn at ${frame}`,
      );
    }
  }
});
