import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { box, ellipsoid, bone } from './docs/fossil-excavation/geometry.ts';
import { fossilExcavation } from './docs/fossil-excavation/scene.ts';
import { writeFossilExcavation } from './docs/fossil-excavation/write.ts';

interface FossilManifestPointer {
  url: string;
}

interface FossilManifest {
  sourceTriangles: number;
  selectedTriangles: number;
  primitives: unknown[];
  scenePlugin: { name: string };
  simplification: boolean;
}

const root = resolve(import.meta.dirname, '..'),
  published = resolve(root, 'site/assets/gallery/fossil-excavation');

test('fossil excavation is deterministic and keeps recognizable material groups', () => {
  const first = fossilExcavation(),
    second = fossilExcavation(),
    triangles = Object.values(first).reduce((sum, part) => sum + part.faces.length, 0);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), [
    'bone',
    'shadow',
    'sandstone',
    'ochre',
    'markerRed',
    'markerBlue',
    'paper',
    'metal',
  ]);
  assert.equal(triangles, 9_784);
  assert.ok(first.bone.faces.length >= 8_000, 'the articulated fossil carries visible detail');
  for (const geometry of Object.values(first)) {
    assert.ok(geometry.vertices.flat().every(Number.isFinite));
    assert.ok(
      geometry.faces.flat().every((index) => index > 0 && index <= geometry.vertices.length),
    );
  }
});

test('published OBJ and MTL are reproduced byte for byte by the recipe', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'wg-fossil-excavation-'));
  try {
    await writeFossilExcavation(temporary, fossilExcavation());
    for (const file of ['excavation.obj', 'excavation.mtl'])
      assert.ok(
        (await readFile(join(temporary, file))).equals(
          await readFile(join(published, 'source', file)),
        ),
        `${file} must reproduce exactly`,
      );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('published cache proves the public OBJ importer and authored groups', async () => {
  const pointer = JSON.parse(
      await readFile(join(published, 'cache/native/full/manifest.json'), 'utf8'),
    ) as FossilManifestPointer,
    manifest = JSON.parse(
      await readFile(join(published, 'cache/native/full', pointer.url), 'utf8'),
    ) as FossilManifest;
  assert.equal(manifest.sourceTriangles, 9_784);
  assert.equal(manifest.selectedTriangles, 9_784);
  assert.equal(manifest.primitives.length, 8);
  assert.equal(manifest.scenePlugin.name, 'obj');
  assert.equal(manifest.simplification, false);
});

test('fossil primitives expose their exterior rather than inward-facing surfaces', () => {
  for (const shape of [
    box([0, 0, 0], [2, 2, 2]),
    ellipsoid([0, 0, 0], [1, 2, 3]),
    bone([0, -1, 0], [0, 1, 0], 1),
  ]) {
    for (const indices of shape.faces) {
      const [a, b, c] = indices.map((index) => shape.vertices[index - 1]);
      const u = b.map((value, axis) => value - a[axis]);
      const v = c.map((value, axis) => value - a[axis]);
      const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      if (Math.hypot(...normal) < 1e-12) continue;
      const outward = normal.reduce(
        (sum, value, axis) => sum + value * (a[axis] + b[axis] + c[axis]),
        0,
      );
      assert.ok(outward > 0, 'the face normal points away from the primitive centre');
    }
  }
});
