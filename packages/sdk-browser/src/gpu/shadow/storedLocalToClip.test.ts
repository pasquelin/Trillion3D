// OMB-25 (#966): the LocalToClip the bin pass stores per caster and view, read back by the stored
// vertex stage, places every corner where the default vertex stage does — the same product,
// `(viewProjection*world)*corner`, on CPU f32 —; the option is off by default and the default
// path is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { HOSTILE_FLOATS } from '../../../../../tests/kit/assert/hostile.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { explorerSwitch } from '../../../../sdk-core/src/runtime/explorerSwitches.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { FLAG_HAS_UV, FLAG_MASK } from '../../visibility/types.ts';
import { DRAW_INDIRECT_WORDS as WORDS } from '../draw/contract.ts';
import { MOBILITY_CORNER_SHIFT, MOBILITY_CUTOUT } from './cullShader.ts';
import { BIN_STORED_STRIDE, SHADOW_BIN_CLASSES, SHADOW_BIN_COMMANDS } from './binShader.ts';
import { createShadowBins } from './bins.ts';
import { binKernel, runBins } from './binReplay.fixture.ts';
import { builtins } from '../../texture/shaderRunBuiltins.fixture.ts';
import { keptList } from './keptList.ts';
import { MAX_SHADOW_REGIONS } from './recordPack.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { SHADOW_STORED_WGSL } from './storedWgsl.ts';
import { shadowDepthDraws } from './depthDraws.ts';
import * as depth from './depthSplit.fixture.ts';

const REGION = 5,
  STORED = ['storedColumn', 'storedLocalToClip', 'storedVertex'];
STORED.push('shadow_depth_stored_vs', 'shadow_cutout_stored_vs');
type Entry = (
  vertexIndex: number,
  instanceIndex: number,
) => depth.ShadowOut | Record<string, number>;
type Corner = (view: unknown, vertex: number, row: number, blended: boolean) => depth.ShadowOut;

/** `rows` casters of 1 to 3 triangles, a third cutouts, their numbers now and then `special`. */
function scene(rng: () => number, rows: number, special?: number) {
  const odd = (value: number) => (special !== undefined && rng() < 0.2 ? special : value);
  const around = (spread: number) => odd((rng() * 2 - 1) * spread);
  const positions: number[] = [],
    indices: number[] = [];
  const pages = Array.from({ length: rows }, () => {
    const corners = 3 * (1 + Math.floor(rng() * 3)),
      vertexBase = positions.length / 3,
      pageOffset = indices.length;
    for (let k = 0; k < corners; k++) {
      indices.push(k);
      positions.push(around(1.3), around(1.3), odd(rng()));
    }
    const world = [
      depth.vec4f(1 + around(0.1), around(0.1), 0, 0),
      depth.vec4f(0, 1, around(0.1), 0),
    ];
    world.push(
      depth.vec4f(0, around(0.1), 1, 0),
      depth.vec4f(around(0.2), around(0.2), around(0.02), 1),
    );
    const flags = rng() < 0.3 ? FLAG_MASK | FLAG_HAS_UV : 0;
    return {
      flags,
      indexCount: corners,
      pageOffset,
      vertexBase,
      world,
      dash: { x: 0, y: 0 },
      baseColor: { w: 0 },
      deformOutput: 0,
    };
  });
  // A lamp's perspective face or a sun's affine one, which `sunSnap` snaps.
  const lamp = rng() < 0.5,
    viewProjection = [
      depth.vec4f(1, 0, 0, 0),
      depth.vec4f(0, 1, 0, 0),
      depth.vec4f(0, 0, odd(0.5), lamp ? 1 : 0),
    ];
  viewProjection.push(depth.vec4f(around(0.1), around(0.1), odd(0.5), lamp ? 0 : 1));
  const shadow = {
    viewProjection,
    params: depth.vec4f(0, 0, SHADOW_PAGE / 8192, SHADOW_PAGE),
    emitter: depth.vec4f(0, 0, 0, 0),
  };
  return { pages, indices, positions, uvs: positions.map(() => 0), shadow };
}

/** Every corner of `rows` casters through the stored path and the default one, bit for bit. */
function storedMatches(rng: () => number, rows: number, special?: number) {
  const world = scene(rng, rows, special),
    capacity = rows + 2;
  const cutout = (row: number) => (world.pages[row].flags & FLAG_MASK) !== 0;
  const mobility = world.pages.map(
    (page, row) => (page.indexCount << MOBILITY_CORNER_SHIFT) | (cutout(row) ? MOBILITY_CUTOUT : 0),
  );
  const list = new Array<number>((REGION + 1) * capacity).fill(0),
    counts = new Array<number>((REGION + 1) * 2 * WORDS).fill(0);
  for (let row = 0; row < rows; row++) {
    const command = (REGION * 2 + +cutout(row)) * WORDS,
      rank = counts[command + 1]++;
    list[REGION * capacity + (cutout(row) ? capacity - 1 - rank : rank)] = row;
    counts[command] = Math.max(counts[command], world.pages[row].indexCount);
  }
  const binned = new Array<number>(MAX_SHADOW_REGIONS * capacity * BIN_STORED_STRIDE).fill(0),
    commands = new Array<number>((REGION + 1) * SHADOW_BIN_COMMANDS * WORDS).fill(0);
  const views = Array.from({ length: REGION + 1 }, () => world.shadow);
  const uni = { regions: REGION + 1, capacity, maskLow: 1 << REGION, maskHigh: 0 };
  const kernel = binKernel(true, {
    uni,
    list,
    counts,
    mobility,
    binned,
    commands,
    pages: world.pages,
    views,
    mul: depth.mul,
  });
  runBins(kernel, REGION + 1, () => [...Array(64).keys()]);
  const all: depth.ShadowScene = {
    ...world,
    instances: binned,
    slotOffsets: Array.from({ length: MAX_SHADOW_REGIONS + 1 }, (_, r) => r * capacity),
    uni: { indirect: 1, drawSlot: REGION },
  };
  const base = depth.shadowEntries(all);
  let source = SHADOW_STORED_WGSL.replace(/@\w+(?:\([^)]*\))? ?/g, '')
    .replace(/var (\w+):\w+;/g, 'let $1={};')
    .replace(/bitcast<f32>\(/g, 'bitcast_f32(');
  for (const [shape, spelled] of [
    ['storedLocalToClip(place)*local', 'mul(storedLocalToClip(place),local)'],
    ['(page.world*local).xyz-shadow.emitter.xyz', 'sub3(mul(page.world,local),shadow.emitter)'],
  ]) {
    assert.ok(source.includes(shape), shape);
    source = source.replace(shape, spelled);
  }
  const { vec2f, vec3f, vec4f, mul, sub3 } = depth;
  const mat4x4f = (...columns: unknown[]) => columns;
  const { bitcast_f32 } = builtins;
  const scope = { ...all, ...base, vec2f, vec3f, vec4f, mul, sub3, bitcast_f32, mat4x4f };
  const stored = shaderFunctions<Record<string, Entry>>(source, STORED, scope);
  const corner = (base as unknown as { shadowVertexIn: Corner }).shadowVertexIn;
  let corners = 0;
  for (let bin = 0; bin < SHADOW_BIN_COMMANDS; bin++) {
    const at = (REGION * SHADOW_BIN_COMMANDS + bin) * WORDS,
      [count, instances, , first] = commands.slice(at, at + WORDS),
      isCutout = bin >= SHADOW_BIN_CLASSES;
    for (let i = first; i < first + instances; i++) {
      const place = REGION * capacity + (isCutout ? capacity - 1 - i : i);
      for (let v = 0; v < count; v++) {
        const entry = isCutout ? stored.shadow_cutout_stored_vs : stored.shadow_depth_stored_vs;
        const out = entry(v, i),
          position = (isCutout ? (out as depth.ShadowOut).position : out) as Record<string, number>;
        const expected = corner(world.shadow, v, binned[place], false).position;
        for (const axis of ['x', 'y', 'z', 'w'])
          assert.ok(
            Object.is(position[axis], expected[axis]),
            `${axis}: ${position[axis]} vs ${expected[axis]}`,
          );
        corners++;
      }
    }
  }
  return corners;
}

test('the stored LocalToClip places every corner where the vertex stage does, to the bit', () => {
  const rng = mulberry32(25);
  let corners = 0;
  for (let trial = 0; trial < 200; trial++)
    corners += storedMatches(rng, 1 + Math.floor(rng() * 30));
  for (const special of HOSTILE_FLOATS) corners += storedMatches(rng, 24, special);
  assert.ok(corners > 10_000, `${corners} corners compared`);
});

test('the option is off by default, and the default path keeps its entries and lists', async () => {
  assert.equal(explorerSwitch({}, 'shadowLocalToClip'), false);
  assert.equal(explorerSwitch({ shadowLocalToClip: true }, 'shadowLocalToClip'), true);
  // The stored entries are appended: the shader before them is the default path's, untouched.
  assert.ok(SHADOW_DEPTH_SHADER.endsWith(SHADOW_STORED_WGSL));
  const before = SHADOW_DEPTH_SHADER.slice(0, -SHADOW_STORED_WGSL.length);
  assert.ok(!before.includes('_stored_vs') && !before.includes('storedLocalToClip'));
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 2 ** 30 } });
  const draws = shadowDepthDraws(device, {} as GPUShaderModule, {} as GPUPipelineLayout);
  const entries = (made: Record<string, GPURenderPipeline>) =>
    Object.values(made).map((p) => (p as unknown as GPURenderPipelineDescriptor).vertex.entryPoint);
  assert.deepEqual(entries(draws.made()), ['shadow_depth_vs', 'shadow_vs', 'shadow_cutout_vs']);
  assert.deepEqual(entries(draws.made(true)), [
    'shadow_depth_stored_vs',
    'shadow_stored_vs',
    'shadow_cutout_stored_vs',
  ]);
  // Off, the bins hold the rows alone, as the cull's list; on, each place's matrix after them.
  const off = await createShadowBins(device, 10, false),
    on = await createShadowBins(device, 10, true);
  assert.equal(off.list.size, keptList(device, 10).size);
  assert.equal(on.list.size, BIN_STORED_STRIDE * keptList(device, 10).size);
  // Past one storage binding, the bins keep the rows alone, drawn by the default entries.
  on.grow(1e7).commit();
  assert.deepEqual([on.stored, on.list.size], [false, keptList(device, 1e7).size]);
});
