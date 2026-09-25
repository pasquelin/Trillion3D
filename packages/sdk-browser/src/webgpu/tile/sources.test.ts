import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createTileSources } from './sources.ts';
import { createTileCounters } from './counters.ts';
import { tileLayout } from '../../texture/tiles.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import type { WebgpuTileAtlas } from './atlas.ts';
import { tileCatalogue } from './catalogue.ts';
import { collectWebgpuMaterialTextures } from '../core/materialTextures.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import { GraphTexture } from '../../host/graph/graph.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { BlendCopy } from '../../cluster/blendCopyContract.ts';

// Behaviour: a block level whose bytes are not the whole blocks its dimensions imply is refused
// where its read resolves — one failure, never held, never read again — and no tile of it takes
// a slot: placed, the tile would stay resident over the texels its slot held before.
test('a block level of the wrong length fails once, is never held, and takes no slot', async () => {
  const placed: unknown[] = [];
  const failures: string[] = [];
  const { device, textureWrites } = fakeDevice();
  const layout = tileLayout(256, 256);
  const tail = { levels: [], blocks: { bc7: [], astc: [] } };
  const read: string[] = [];
  const atlas = {
    kind: 'color',
    textures: [
      { layout, lane: 'rgba', source: { kind: 'baked', sha256: 'a'.repeat(64), atlas: 0, tail } },
    ],
    roomFor: () => true,
    place: (key: unknown) => (placed.push(key), { x: 0, y: 0, layer: 0 }),
    poolOf: () => ({ texture: {} }),
  } as unknown as WebgpuTileAtlas;
  const sources = createTileSources({
    device,
    readLevel: async ({ format }) => (read.push(format), new Uint8Array(1)),
    encoding: poolEncoding('bc7'),
    counters: createTileCounters(),
    onFailure: (phase, error) => failures.push(`${phase}: ${(error as Error).message}`),
  });
  const key = { slot: 0, level: 0, tx: 0, ty: 0 };
  const serve = (frame: number) => sources.serve(atlas, key, frame, () => ({}) as never);
  assert.equal(serve(1), 'waiting');
  await sources.settled();
  assert.equal(serve(2), 'waiting');
  await sources.settled();
  assert.deepEqual(failures, [
    `texture-level-read-failed ${'a'.repeat(64)}/0/0: TEXTURE_LEVEL_BYTES 256x256: 1`,
  ]);
  assert.equal(sources.levels?.bytes, 0, 'the short level is not held');
  assert.deepEqual(placed, []);
  assert.deepEqual(textureWrites, [], 'nothing to write');
  assert.deepEqual(read, ['bc7'], "the level file of the texture's lane, read once");
});

// #42, the wiring from the material census to the GPU reduction: a hosted colour texture reduces
// with the weighted pipeline only when every surface reading it takes its alpha for coverage —
// masked or blended —; one read by an opaque surface, or also as an emissive map, stays plain.
test('a hosted texture is reduced weighted only when every reader takes it for coverage', () => {
  installGpuGlobals();
  const map = () =>
    importHostTexture(new GraphTexture({ data: new Uint8Array(16), width: 2, height: 2 }));
  const [masked, opaque, mixed, blended] = [map(), map(), map(), map()];
  const surface = (fields: object) => ({ alphaTest: 0, transparent: false, ...fields });
  const pages = [
    surface({ map: masked, alphaTest: 0.5 }),
    surface({ map: opaque }),
    surface({ map: mixed, alphaTest: 0.5 }),
    surface({ emissiveMap: mixed }),
  ].map((material) => ({ material }) as unknown as PageRec);
  const copies = [{ surface: surface({ map: blended, transparent: true }) }] as BlendCopy[];
  const census = collectWebgpuMaterialTextures(pages, copies, new Map(), new Map());
  const encoding = poolEncoding(undefined);
  const hosted = () => undefined;
  const textures = tileCatalogue(census.maps, hosted, undefined, encoding, census.coverage);
  const atlas = {
    kind: 'color',
    textures,
    roomFor: () => true,
    place: () => ({ x: 0, y: 0, layer: 0 }),
    poolOf: () => ({ texture: { format: 'rgba8unorm-srgb' } }),
  } as unknown as WebgpuTileAtlas;
  // One device per texture: the reduction pipeline it builds says the rule that texture took.
  const ruleOf = (slot: number) => {
    const { device } = mockGpu();
    const rules: unknown[] = [];
    const create = device.createRenderPipeline.bind(device);
    Object.assign(device, {
      createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
        rules.push(descriptor.fragment?.constants?.weighted);
        return create(descriptor);
      },
    });
    const sources = createTileSources({
      device,
      encoding,
      counters: createTileCounters(),
      onFailure: (_, error) => assert.fail(error as Error),
    });
    const served = sources.serve(atlas, { slot, level: 0, tx: 0, ty: 0 }, 1, () =>
      device.createCommandEncoder(),
    );
    assert.equal(served, 'served');
    return rules;
  };
  assert.deepEqual(
    census.maps.map((_, index) => ruleOf(index + 1)),
    [[1], [0], [0], [1]],
    'masked and blended weighted; opaque and mixed plain',
  );
});
