import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertImpostorSection,
  impostorMeshBaked,
  validateImpostorSection,
  type ImpostorMesh,
} from './impostor.ts';

function section() {
  const map = () => ({
    kind: 'coverage',
    levels: [{ url: 'atlas.png', sha256: 'abc', bytes: 12, width: 4, height: 8 }],
  });
  return {
    version: 1,
    frames: 2,
    meshes: [
      {
        mesh: 7,
        status: 'baked',
        maps: { colourCoverage: map(), normalDepth: map(), orm: map() },
        frames: 2,
        frameSide: 4,
        objectRadius: 3,
        rootTriangles: 6,
        coverage: 0.5,
      },
    ],
  };
}
const refused = (value: unknown) => {
  assert.ok(validateImpostorSection(value));
  assert.throws(
    () => assertImpostorSection(value),
    (error: any) =>
      error.name === 'EngineError' &&
      error.code === 'UNSUPPORTED_FORMAT' &&
      error.message.includes('Cannot read impostors:'),
  );
};

test('absent atlases remain optional while valid sections retain identity', () => {
  for (const value of [undefined, null]) assert.equal(validateImpostorSection(value), null);
  assert.equal(assertImpostorSection(undefined), undefined);
  const value = section();
  assert.equal(validateImpostorSection(value), null);
  assert.equal(assertImpostorSection(value), value);
  value.meshes[0].status = 'refused';
  delete (value.meshes[0] as any).maps;
  assert.equal(validateImpostorSection(value), null);
});

test('sections reject malformed headers and nonpositive switch inputs independently', () => {
  for (const value of [false, 0, 'atlas', []])
    assert.equal(validateImpostorSection(value), 'the impostors section is not an object');
  for (const value of [
    false,
    0,
    'atlas',
    [],
    {},
    { ...section(), version: 2 },
    { ...section(), meshes: {} },
  ])
    refused(value);
  for (const frames of [undefined, 1, 1.5, NaN, Infinity, '2']) refused({ ...section(), frames });
  for (const key of ['frames', 'frameSide', 'objectRadius', 'rootTriangles', 'coverage']) {
    const invalid =
      key === 'frames'
        ? [undefined, 0, 1, 2.5, NaN, Infinity, '2']
        : key === 'frameSide'
          ? [undefined, 0, -1, 1.5, NaN, Infinity, '4']
          : [undefined, 0, -1, NaN, Infinity, '3'];
    for (const value of invalid) {
      const input = section();
      (input.meshes[0] as any)[key] = value;
      refused(input);
    }
  }
});

test('all three maps and every stored level must be readable', () => {
  const callableLevel = section();
  (callableLevel.meshes[0].maps.orm as any).levels = [
    Object.assign(() => {}, callableLevel.meshes[0].maps.orm.levels[0]),
  ];
  refused(callableLevel);
  const callableMap = section();
  (callableMap.meshes[0].maps as any).orm = Object.assign(() => {}, callableMap.meshes[0].maps.orm);
  refused(callableMap);
  const callableMaps = section();
  (callableMaps.meshes[0] as any).maps = Object.assign(() => {}, callableMaps.meshes[0].maps);
  refused(callableMaps);
  for (const key of ['colourCoverage', 'normalDepth', 'orm'] as const) {
    const value = section();
    const map = value.meshes[0].maps[key];
    (value.meshes[0].maps as any)[key] = Object.assign([], map);
    refused(value);
    const other = section();
    (other.meshes[0].maps[key] as any).levels = [Object.assign([], map.levels[0])];
    refused(other);
  }
  const arrayMaps = section();
  (arrayMaps.meshes[0] as any).maps = Object.assign([], arrayMaps.meshes[0].maps);
  refused(arrayMaps);
  const mixed = section();
  mixed.meshes[0].maps.orm.levels.push({ url: '', sha256: 'bad', bytes: 0, width: 0, height: 0 });
  refused(mixed);
  for (const maps of [undefined, null, [], false, {}]) {
    const value = section();
    (value.meshes[0] as any).maps = maps;
    refused(value);
  }
  for (const key of ['colourCoverage', 'normalDepth', 'orm'] as const) {
    for (const map of [
      undefined,
      null,
      [],
      false,
      {},
      { kind: 3, levels: [] },
      { kind: 'data', levels: {} },
    ]) {
      const value = section();
      (value.meshes[0].maps as any)[key] = map;
      refused(value);
    }
    for (const level of [undefined, null, false, [], 'level', {}]) {
      const value = section();
      (value.meshes[0].maps[key] as any).levels = [level];
      refused(value);
    }
    for (const field of ['url', 'sha256', 'bytes', 'width', 'height']) {
      const invalid = ['url', 'sha256'].includes(field)
        ? [undefined, '', 3]
        : [undefined, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '4'];
      for (const setting of invalid) {
        const value = section();
        (value.meshes[0].maps[key].levels[0] as any)[field] = setting;
        refused(value);
      }
    }
    const value = section();
    Object.assign(value.meshes[0].maps[key].levels[0], { bytes: 0, width: 0, height: 0 });
    assert.equal(validateImpostorSection(value), null);
  }
});

test('drawable mesh guard distinguishes valid cards from partial and refused entries', () => {
  const value = section().meshes[0] as unknown as ImpostorMesh;
  assert.equal(impostorMeshBaked(value), true);
  for (const patch of [
    { status: 'refused' },
    { maps: undefined },
    { frames: undefined },
    { frames: 1 },
    { frames: 2.5 },
    { frameSide: undefined },
    { frameSide: 0 },
    { frameSide: 1.5 },
  ])
    assert.equal(impostorMeshBaked({ ...value, ...patch }), false);
});
