// #364: a sprite is a picture that always faces the camera, as the reference's `Sprite`. The real
// text of both shaders and its CPU twin turn its quad toward the image, and every raster that
// draws a sprite reads that one text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPRITE_GLSL, SPRITE_WGSL, spriteAt } from './spriteWgsl.ts';
import { runShaderText } from './shaderText.fixture.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { rasterVisibilityIds } from '../buffer.ts';
import { surfaceOf } from '../../page/surface.ts';
import { hostSurface } from '../../world/core/worldSurface.ts';
import { object } from '../../../../sdk-core/src/world/object/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { MaterialParameters } from '../../../../sdk-core/src/world/material/material.ts';

/** The engine camera at `eye`, looking at the origin: 55° of field on a square image. */
function camera(eye: number[]) {
  const cam = G.perspectiveCamera(55, 1, 0.1, 1000);
  cam.position.set(eye[0], eye[1], eye[2]);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cameraMoteur(cam);
}
const columns = (m: ArrayLike<number>) =>
  [0, 1, 2, 3].map((c) => Array.from(m).slice(c * 4, c * 4 + 4));
const clipOf = (m: ArrayLike<number>, p: ArrayLike<number>) =>
  [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

/** A world matrix: a position, a turn about `y` and a scale per axis. */
function place(at: number[], turn: number, scale: number[]) {
  const m = new G.Matrix4();
  m.compose(
    new G.Vector3(at[0], at[1], at[2]),
    new G.Quaternion().setFromAxisAngle(new G.Vector3(0, 1, 0), turn),
    new G.Vector3(scale[0], scale[1], scale[2]),
  );
  return m.elements;
}

const RUNS = { wgsl: runShaderText(SPRITE_WGSL), glsl: runShaderText(SPRITE_GLSL) };
const CASES = [
  { eye: [0, 0, 6], at: [0.4, -0.2, 1], turn: 0, scale: [1, 1, 1], rotation: 0, attenuate: true },
  { eye: [7, 2, 0], at: [0, 1, 0], turn: 1.1, scale: [3, 1.5, 1], rotation: 0.7, attenuate: true },
  {
    eye: [-3, 1, -9],
    at: [1, 0, 2],
    turn: 2,
    scale: [2, 2, 0.5],
    rotation: -1.3,
    attenuate: false,
  },
];

// The WGSL text, the GLSL text and the CPU twin are one formula: the same corner, in every case.
for (const [language, run] of Object.entries(RUNS))
  test(`${language}: the shader text turns a corner where the CPU twin does`, () => {
    for (const c of CASES) {
      const toClip = camera(c.eye).viewProjection,
        world = place(c.at, c.turn, c.scale);
      const sprite = { rotation: c.rotation, sizeAttenuation: c.attenuate };
      for (const [x, y] of [
        [0.5, 0.5],
        [-0.5, 0.25],
        [0, 0],
      ]) {
        const cpu = spriteAt(new Float64Array(4), toClip, world, x, y, sprite);
        const words = [c.rotation, c.attenuate ? 1 : -1];
        const text = run(columns(toClip), columns(world), [x, y], words);
        for (let i = 0; i < 4; i++) assert.ok(Math.abs(cpu[i] - text[i]) < 1e-9, `${x},${y} ${i}`);
      }
    }
  });

// The corner lies in the image plane at its origin's depth, as far from it on screen as the
// reference's `projectionMatrix · (mvPosition + offset)` puts it, whatever the sprite's turn.
test('a corner stays at its origin depth, turned in the image plane only', () => {
  for (const c of CASES) {
    const cam = camera(c.eye),
      world = place(c.at, c.turn, c.scale);
    const origin = clipOf(cam.viewProjection, world.slice(12, 15));
    const corner = spriteAt(new Float64Array(4), cam.viewProjection, world, 0.5, 0, {
      rotation: c.rotation,
      sizeAttenuation: true,
    });
    const clip = clipOf(cam.viewProjection, corner);
    assert.ok(Math.abs(clip[3] - origin[3]) < 1e-9, 'the same view depth');
    const p = cam.projection;
    const ax = 0.5 * c.scale[0];
    assert.ok(Math.abs(clip[0] - origin[0] - p[0] * ax * Math.cos(c.rotation)) < 1e-9);
    assert.ok(Math.abs(clip[1] - origin[1] - p[5] * ax * Math.sin(c.rotation)) < 1e-9);
  }
});

// `sizeAttenuation: false` keeps the sprite's size on screen at every distance; true shrinks it.
test('a sprite without size attenuation keeps its screen size at every distance', () => {
  const height = (distance: number, sizeAttenuation: boolean) => {
    const cam = camera([0, 0, distance]),
      world = place([0, 0, 0], 0, [1, 1, 1]);
    const top = spriteAt(new Float64Array(4), cam.viewProjection, world, 0, 0.5, {
      rotation: 0,
      sizeAttenuation,
    });
    const clip = clipOf(cam.viewProjection, top);
    return clip[1] / clip[3];
  };
  for (const distance of [2, 20, 200])
    assert.ok(Math.abs(height(distance, false) - height(1, false)) < 1e-9, `${distance} m`);
  assert.ok(Math.abs(height(20, true) * 10 - height(2, true)) < 1e-9);
});

/** Pixels a sprite of `parameters` covers, drawn by the CPU raster from `eye`, turned `turn`. */
function covered(eye: number[], turn = 0, parameters: MaterialParameters = {}) {
  const sprite = object.sprite(material.sprite({ color: '#ff0', ...parameters }));
  const drawn = drawnTriangles(sprite.geometry, 'sprite')!;
  const surface = hostSurface(sprite.material as Material, false, new Map(), 'sprite');
  const geometry = new G.Geometry();
  geometry.setAttribute('position', G.floatAttribute(drawn.positions, 3));
  const matrix = new G.Matrix4();
  matrix.elements.set(place([0, 0, 0], turn, [1, 1, 1]));
  const page = { array: drawn.indices, attributes: geometry.attributes, matrix };
  const ids = rasterVisibilityIds(
    [{ ...page, material: surfaceOf(surface) }],
    camera(eye),
    [256, 256],
  );
  return ids.filter((id) => id !== 0).length;
}

// The issue's fixture: one sprite seen from the front, the side and behind covers the same pixel
// count, within 1 %; a sprite whose object is turned too, since its turn is not read.
test('one sprite seen from the front, the side and behind covers the same pixels', () => {
  const front = covered([0, 0, 5]);
  assert.ok(front > 1000, `${front} pixels from the front`);
  for (const [eye, turn] of [
    [[5, 0, 0], 0],
    [[0, 0, -5], 0],
    [[0, 5, 0.001], 0],
    [[0, 0, 5], Math.PI / 2],
  ] as const) {
    const seen = covered([...eye], turn);
    assert.ok(Math.abs(seen - front) <= front * 0.01, `${eye} turned ${turn}: ${seen} ≠ ${front}`);
  }
  // A quarter turn of the picture changes nothing to a square's coverage; half its scale does.
  const turned = covered([5, 0, 0], 0, { rotation: Math.PI / 2 });
  assert.ok(Math.abs(turned - front) <= front * 0.01);
});
