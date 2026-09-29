import test from 'node:test';
import assert from 'node:assert/strict';
import { animation } from './index.ts';
import { paletteReach, PALETTE_FLOATS } from './skeleton.ts';
import { object } from '../object/index.ts';
import { geometry } from '../geometry/index.ts';
import { material } from '../material/index.ts';

const close = (actual: number, expected: number, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

/** A chain of three bones one unit apart along y, under a root. */
function chain() {
  const root = object.group(),
    hip = object.group(),
    knee = object.group(),
    foot = object.group();
  [hip.name, knee.name, foot.name] = ['hip', 'knee', 'foot'];
  knee.position.set(0, 1, 0);
  foot.position.set(0, 1, 0);
  root.add(hip);
  hip.add(knee);
  knee.add(foot);
  root.updateMatrixWorld(true);
  return { root, hip, knee, foot };
}

test('a palette carries a bind vertex where its bone moved it, within the reach it bounds', () => {
  const { root, hip, knee } = chain();
  const skeleton = animation.skeleton([hip, knee]);
  knee.quaternion.setFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
  knee.position.set(0.5, 1, 0);
  root.updateMatrixWorld(true);
  const palette = skeleton.palette(root.matrixWorld.elements, new Float32Array(2 * PALETTE_FLOATS));
  // A vertex at (0, 2, 0) on the knee turns a quarter about z around the knee, then slides.
  const m = palette.subarray(PALETTE_FLOATS);
  const moved = [0, 1, 2].map((row) => m[row * 4] * 0 + m[row * 4 + 1] * 2 + m[row * 4 + 3]);
  [-0.5, 1, 0].forEach((value, c) => close(moved[c], value));
  // The knee's rest ball (centre (0, 1.5, 0), radius 0.5) moves by at most what the bound says.
  const reach = paletteReach(palette, 0, 2, [0, 0.5, 0, 0.5, 0, 1.5, 0, 0.5]);
  assert.ok(reach >= Math.hypot(-0.5 - 0, 1 - 2, 0), `${reach}`);
  assert.equal(
    paletteReach(skeleton.palette(root.matrixWorld.elements, palette), 0, 1, [0, 0.5, 0, 0.5]),
    0,
  );
});

test('an additive action adds its motion from its first key on top of the others', () => {
  const { root, hip } = chain();
  const mixer = animation.createMixer(root);
  const stand = animation.clip('stand', 1, [
    animation.vectorTrack('hip.position', [0, 1], [2, 0, 0, 2, 0, 0]),
  ]);
  const nod = animation.clip('nod', 1, [
    animation.vectorTrack('hip.position', [0, 1], [0, 0, 0, 0, 3, 0]),
  ]);
  mixer.clipAction(stand).play();
  Object.assign(mixer.clipAction(nod), { blendMode: 'additive', weight: 0.5 }).play();
  mixer.update(0.5);
  [2, 0.75, 0].forEach((value, c) =>
    close([hip.position.x, hip.position.y, hip.position.z][c], value),
  );
});

test('a weights track writes every morph weight of a mesh, and a cubic spline follows its tangents', () => {
  const box = geometry.box(1, 1, 1);
  box.morphAttributes.position = [box.attributes.position, box.attributes.position];
  const mesh = object.mesh(box, material.meshBasic());
  mesh.name = 'face';
  const root = object.group().add(mesh);
  const smile = animation.clip('smile', 1, [
    animation.weightsTrack('face.morphTargetInfluences', [0, 1], [0, 1, 1, 0]),
    {
      ...animation.vectorTrack(
        'face.position',
        [0, 1],
        [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ),
      interpolation: 'cubic',
    },
  ]);
  const mixer = animation.createMixer(root);
  mixer.clipAction(smile).play();
  mixer.update(0.25);
  assert.deepEqual(mesh.morphTargetInfluences, [0.25, 0.75]);
  // Out-tangent (1, 0, 0) at the first key, one second long: x = t − 2t² + t³ at a quarter.
  close(mesh.position.x, 0.25 - 2 * 0.0625 + 0.015625);
});

test('a two-bone chain bent by IK puts its end on a reachable target', () => {
  const { hip, knee, foot } = chain();
  animation.twoBoneIK(hip, knee, foot, { x: 1, y: 1, z: 0 });
  const end = foot.getWorldPosition();
  [1, 1, 0].forEach((value, c) => close([end.x, end.y, end.z][c], value, 1e-6));
});

test('wind bends each bone no further than the angle it declares', () => {
  const { hip, knee, foot } = chain();
  const clip = animation.windClip([hip, knee, foot], { direction: [1, 0], angle: 0.2 });
  for (const track of clip.tracks)
    for (let k = 0; k < track.times.length; k++) {
      const w = Math.min(1, Math.abs(track.values[k * 4 + 3]));
      assert.ok(2 * Math.acos(w) <= 0.2 + 1e-6);
    }
});
