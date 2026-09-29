// #1239: the runtime contract of the `impostors` section (#817) — absent stays readable, a `baked`
// entry carries the three maps and the four numbers its card and switch read, and an unknown
// version is refused by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from './cache.ts';
import {
  IMPOSTOR_VERSION,
  assertImpostorSection,
  impostorMeshBaked,
  validateImpostorSection,
  type ImpostorMesh,
  type ImpostorSection,
} from './impostor.ts';

const level = { url: 'objects/a.bin', sha256: 'a', bytes: 4, width: 1, height: 1 };
const maps = {
  colourCoverage: { kind: 'coverage', levels: [level] },
  normalDepth: { kind: 'data', levels: [level] },
  orm: { kind: 'data', levels: [level] },
};
const section = (over: Partial<ImpostorSection> = {}): ImpostorSection => ({
  version: IMPOSTOR_VERSION,
  frames: 12,
  focalPixels: 2146,
  textureLimit: 8192,
  baked: 1,
  refused: 0,
  meshes: [
    {
      mesh: 1,
      sourceMesh: 1,
      name: 'tree',
      placements: 20,
      masked: true,
      rootTriangles: 2100,
      radius: 4.2,
      status: 'baked',
      coverage: 0.43,
      hemi: false,
      frames: 12,
      frameSide: 128,
      atlasSide: 1536,
      objectRadius: 4.2,
      switchDepth: { texel: 1, triangles: 2 },
      maps,
    },
  ],
  ...over,
});

test('an absent section is readable and draws every mesh in full', () => {
  assert.equal(validateImpostorSection(undefined), null);
  assert.equal(assertImpostorSection(undefined), undefined);
});

test('a version this build does not read is refused whole', () => {
  assert.match(validateImpostorSection(section({ version: 2 })) ?? '', /version/);
});

test('a baked entry without its maps, frame count or frame side is refused', () => {
  const meshesWith = (over: Partial<ImpostorMesh>) =>
    section().meshes.map((mesh) => ({ ...mesh, ...over }));
  const problem = (over: Partial<ImpostorMesh>) =>
    validateImpostorSection(section({ meshes: meshesWith(over) })) ?? '';
  assert.match(problem({ maps: undefined }), /three maps/);
  assert.match(problem({ frames: undefined }), /frame count/);
  assert.match(problem({ frameSide: undefined }), /frame side/);
});

test('impostorMeshBaked is true only for a baked entry with its drawable atlas', () => {
  const [mesh] = section().meshes;
  assert.equal(impostorMeshBaked(mesh), true);
  assert.equal(impostorMeshBaked({ ...mesh, status: 'refused' }), false);
  assert.equal(impostorMeshBaked({ ...mesh, maps: undefined }), false);
});

test('assertImpostorSection returns its section and throws the named refusal', () => {
  const built = section();
  assert.equal(assertImpostorSection(built), built);
  assert.throws(
    () => assertImpostorSection({ version: 99 }),
    (error: unknown) => error instanceof EngineError && error.code === 'UNSUPPORTED_FORMAT',
  );
});
