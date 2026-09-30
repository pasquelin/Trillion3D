import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { CLASS_DEPTH_UNITS } from '../../visibility/shader/classWords.ts';
import {
  MATERIAL_TILE_DRAW_WGSL,
  MATERIAL_TILE_SLOTS,
  MATERIAL_TILES_SHADER,
} from '../../visibility/shader/materialTilesWgsl.ts';
import {
  MATERIAL_TILES_PASS,
  createMaterialTiles,
  materialTileDrawLayout,
} from './materialTiles.ts';
import { encodeMaterialPasses } from './materialPasses.ts';
import { resolveFixture } from './materialPasses.fixture.ts';

type Fn = (...args: number[]) => number;
type Corner = (tile: number, i: number, tilesX: number) => { x: number; y: number };

test('a pixel is marked for the one class whose depth the material depth writes it', () => {
  const classSlots = new Uint32Array(8192).fill(MATERIAL_TILE_SLOTS);
  classSlots[4] = 0;
  classSlots[8] = 1;
  const { pixelSlot, materialClassDepth } = shaderFunctions<Record<string, Fn>>(
    MATERIAL_TILES_SHADER,
    ['materialClassOf', 'materialClassDepth', 'pixelSlot'],
    {
      ...wgslConstants(MATERIAL_TILES_SHADER),
      uni: { pageCount: 3 },
      pages: [
        { materialClass: 4 },
        { materialClass: 8 },
        { materialClass: 2 },
        { materialClass: 8 },
      ],
      classSlots,
    },
  );
  // The background, three pages (the third a class the image does not hold), one past the count.
  for (const id of [0, (1 << 8) | 7, 2 << 8, 3 << 8, 4 << 8]) {
    const depth = materialClassDepth(id),
      slot = pixelSlot(id);
    if (depth === 0) assert.equal(slot, MATERIAL_TILE_SLOTS, `id ${id}`);
    else assert.equal(slot, classSlots[depth * CLASS_DEPTH_UNITS - 1], `id ${id}`);
  }
  assert.equal(pixelSlot(1 << 8), 0);
  assert.equal(pixelSlot(2 << 8), 1);
});

test("a tile's two triangles are its square, corners on whole pixels its neighbours share", () => {
  const { materialTileCorner } = shaderFunctions<{ materialTileCorner: Corner }>(
    MATERIAL_TILE_DRAW_WGSL,
    ['materialTileCorner'],
    wgslConstants(MATERIAL_TILE_DRAW_WGSL),
  );
  const corners = [0, 1, 2, 3, 4, 5].map((i) => materialTileCorner(4, i, 3));
  // Tile 4 of a row of 3: column 1, row 1. Top-left, top-right, bottom-left, then the other half.
  assert.deepEqual(
    corners.map(({ x, y }) => [x, y]),
    [
      [32, 32],
      [64, 32],
      [32, 64],
      [32, 64],
      [64, 32],
      [64, 64],
    ],
  );
  assert.deepEqual(materialTileCorner(5, 0, 3), materialTileCorner(4, 1, 3));
});

test('each class draws the tiles its slot lists, classified once after the material depth', () => {
  const { rt, encoder, passes, tiles } = resolveFixture([5, 9, 5, 2], [5, 9, 2]);
  const groups: unknown[] = [];
  const begin = encoder.beginRenderPass.bind(encoder);
  encoder.beginRenderPass = ((desc: GPURenderPassDescriptor) => {
    const pass = begin(desc);
    pass.setBindGroup = (at: number, group: unknown) => void groups.push([at, group]);
    return pass;
  }) as typeof encoder.beginRenderPass;
  encodeMaterialPasses(rt, encoder);
  assert.deepEqual(tiles.assigned, [[5, 9, 2]]);
  assert.equal(tiles.classified, 1);
  assert.deepEqual(tiles.slots, [0, 1, 2], 'class `at` of the keys draws slot `at`');
  assert.equal(passes[1].draws, 3);
  assert.deepEqual(groups.slice(-2), [
    [0, 'bind group'],
    [1, 'tile group'],
  ]);
  // A sole class shades full screen: nothing is classified.
  const one = resolveFixture([5], [5], [5]);
  encodeMaterialPasses(one.rt, one.encoder);
  assert.equal(one.tiles.classified, 0);
  assert.deepEqual(one.tiles.slots, []);
});

test('the slots follow the classes held; a list is drawn indirectly, a class past them whole', async () => {
  installGpuGlobals();
  const { device, buffers, computes } = mockGpu({ compute: true });
  const tiles = await createMaterialTiles(device, materialTileDrawLayout(device));
  const table = () => {
    const data = buffers.find((b) => b.label === 'Trillion3D material tile slots')!.data;
    return new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  };
  tiles.assign([5, 9]);
  assert.deepEqual([table()[5], table()[9], table()[2]], [0, 1, MATERIAL_TILE_SLOTS]);
  tiles.assign([9]);
  assert.deepEqual([table()[5], table()[9]], [MATERIAL_TILE_SLOTS, 0]);
  const many = Array.from({ length: MATERIAL_TILE_SLOTS + 1 }, (_, key) => key + 100);
  tiles.assign(many);
  assert.equal(table()[100 + MATERIAL_TILE_SLOTS], MATERIAL_TILE_SLOTS);
  const passes: string[] = [];
  const encoder = device.createCommandEncoder();
  const begin = encoder.beginComputePass.bind(encoder);
  encoder.beginComputePass = ((desc: GPUComputePassDescriptor) => {
    passes.push(desc.label!);
    return begin(desc);
  }) as typeof encoder.beginComputePass;
  const inputs = { vis: {}, pages: {}, uniform: {} } as never;
  tiles.encode(encoder, 100, 40, inputs);
  assert.deepEqual(
    [passes, computes.at(-1), tiles.tileCount],
    [[MATERIAL_TILES_PASS], 'classify', 8],
  );
  const drawn: unknown[] = [];
  const pass = {
    drawIndirect: (_: unknown, offset: number) => drawn.push(['indirect', offset]),
    draw: (vertices: number, instances: number) => drawn.push(['draw', vertices, instances]),
  } as unknown as GPURenderPassEncoder;
  tiles.draw(pass, 1);
  tiles.draw(pass, MATERIAL_TILE_SLOTS);
  assert.deepEqual(drawn, [
    ['indirect', 16],
    ['draw', 6, 8],
  ]);
});

test('a device that refuses the classification draws every class on every tile', async () => {
  installGpuGlobals();
  class GPUPipelineError extends Error {}
  Object.assign(globalThis, { GPUPipelineError });
  const { device, computes } = mockGpu({ compute: true });
  device.createComputePipeline = (() => {
    throw new GPUPipelineError('refused');
  }) as typeof device.createComputePipeline;
  const tiles = await createMaterialTiles(device, materialTileDrawLayout(device));
  tiles.assign([5, 9]);
  tiles.encode(device.createCommandEncoder(), 64, 64, { vis: {}, pages: {}, uniform: {} } as never);
  assert.deepEqual(computes, []);
  const drawn: unknown[] = [];
  const pass = {
    draw: (vertices: number, instances: number) => drawn.push([vertices, instances]),
  } as unknown as GPURenderPassEncoder;
  tiles.draw(pass, 0);
  assert.deepEqual(drawn, [[6, 4]]);
});

test('a classification that does not compile fails by name, never silently whole', async () => {
  installGpuGlobals();
  const { device } = mockGpu({ compute: true });
  const refused = {
    getCompilationInfo: async () => ({ messages: [{ type: 'error', message: 'x' }] }),
  };
  device.createShaderModule = (() => refused) as unknown as typeof device.createShaderModule;
  await assert.rejects(
    createMaterialTiles(device, materialTileDrawLayout(device)),
    /MATERIAL_TILES: x/,
  );
});

test('the classification reaches its barrier in uniform control flow: no lane leaves its loops early', () => {
  // A `continue` or `break` taken per lane makes the loop, then the barrier after it, non-uniform:
  // WGSL refuses the module, and every image of more than one class would fail to prepare.
  const body = MATERIAL_TILES_SHADER.slice(MATERIAL_TILES_SHADER.indexOf('fn classify'));
  const beforeBarrier = body.slice(0, body.indexOf('workgroupBarrier()'));
  assert.ok(beforeBarrier.length > 0);
  assert.doesNotMatch(beforeBarrier, /\b(continue|break|return)\b/);
});
