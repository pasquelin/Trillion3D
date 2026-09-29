// #1275: one page model for the scheduler and the shaders. Every formula of `pageModel.ts`, run
// from the WGSL the shaders compile (`PAGE_MODEL_WGSL`, through `shaderRun`) and on numbers as the
// scheduler runs it, answers the same, bit for bit, over seeded inputs and their edges; every pass
// that reads the page table holds the model once, and no second copy of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGES,
  lampMipOffset,
  sunPageMetres,
} from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { regionRect } from '../../../../sdk-core/src/scene/light-shadow/volume.ts';
import {
  PAGE_MODEL_FUNCTIONS,
  PAGE_MODEL_WGSL,
} from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import {
  LAMP_FACE_ENTRIES,
  LAMP_MIPS,
  PAGE_INDEX_MASK,
  PAGE_RANGE_MASK,
  SHADOW_PAGE,
  SHADOW_TABLE_ENTRIES,
  SUN_LEVELS,
  lampPagesAt,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { contractLightingShader } from '../deferred/shaders.ts';
import { BLEND_SHADER } from '../../webgpu/blend/shader.ts';
import { WATER_COMPOSITE_SHADER } from '../../webgpu/water/compositeWgsl.ts';
import { SHADOW_DEMAND_WGSL } from '../../webgpu/shadow/demandWgsl.ts';
import { ALLOCATION_WGSL } from '../../webgpu/shadow/allocWgsl.ts';
import { SHADOW_FRESH_WGSL } from '../../webgpu/shadow/freshWgsl.ts';
import { SHADOW_READ_AT_WGSL } from './shadowFactorWgsl.ts';

type Formula = (...args: number[]) => number;
const shipped = shaderRun<Record<string, Formula>>(PAGE_MODEL_WGSL, PAGE_MODEL_FUNCTIONS, {});
const scheduler = PAGES as unknown as Record<string, Formula>;

const r = mulberry32(1275);
const int = (low: number, high: number) => low + Math.floor(r() * (high - low + 1));
/** A seeded value for a parameter, by its name: what the callers hand it. */
const INPUTS: Record<string, () => number> = {
  v: () => int(-5000, 5000),
  n: () => int(1, 64),
  pages: () => int(1, 64),
  x: () => int(-200, 200),
  y: () => int(-200, 200),
  level: () => int(-30, 30),
  finest: () => int(-30, 30),
  origin: () => int(-5000, 5000),
  face: () => int(0, 5),
  mip: () => int(0, LAMP_MIPS - 1),
  footprint: () => 2 ** (r() * 60 - 30),
  texel0: () => 2 ** (r() * 60 - 30),
  tanHalf: () => r() * 4,
  radius: () => r() * 500,
  u: () => (r() - 0.5) * 2e5,
  ndc: () => (r() - 0.5) * 2.2,
  side: () => lampPagesAt(int(0, LAMP_MIPS - 1)) * SHADOW_PAGE,
  first: () => int(-40, 40) * SHADOW_PAGE,
  t: () => (r() - 0.5) * 1e4,
  rest: () => int(0, LAMP_FACE_ENTRIES - 1),
  local: () => int(0, 5000),
  slot: () => int(0, 15),
  r: () => int(0, 63),
  count: () => int(1, 5000),
  low: () => (r() - 0.5) * 4,
  high: () => (r() - 0.5) * 4 + 2.5,
  cells: () => int(1, 8),
  metres: () => 2 ** (r() * 40 - 20),
  size: () => int(1, 64) * SHADOW_PAGE,
  w: () => r() * 40 - 20,
  scale: () => (r() - 0.5) * 64,
  offset: () => (r() - 0.5) * 64,
  h: () => 2 ** (r() * 40 - 20),
  far: () => 2 ** (r() * 20 - 5),
  f: () => r() * 2 - 1,
  chord: () => r() * 2,
  halfFov: () => r() * 2,
  zNear: () => (r() - 0.5) * 1e4,
  p: () => (r() - 0.5) * 1e4,
  d: () => r() * 2 - 1,
  s: () => (r() - 0.5) * 1e3,
  rank: () => int(0, (SUN_LEVELS - 1) * LAMP_MIPS),
  entry: () => int(0, SHADOW_TABLE_ENTRIES - 1),
  age: () => int(1, 600),
  page: () => int(0, PAGE_INDEX_MASK),
  range: () => int(0, PAGE_RANGE_MASK),
  footprintBits: () => int(0, 255),
};
/** Texels on and about the edges the PCF and the page of a texel turn on, from a page's first. */
const EDGES = [-1.5, -1.5 - 2 ** -20, 0, 1.5, 1.5 - 2 ** -20, 64, 64 - 2 ** -20, 126.5, 128];

test('every page formula answers the same in the shaders and in the scheduler', () => {
  const signatures = [...PAGE_MODEL_WGSL.matchAll(/fn (\w+)\(([^)]*)\)/g)];
  assert.deepEqual(
    signatures.map(([, name]) => name),
    PAGE_MODEL_FUNCTIONS,
  );
  for (const [, name, list] of signatures) {
    const params = list.split(',').map((param) => param.split(':')[0]);
    for (let k = 0; k < 4000; k++) {
      const args = params.map((param) => INPUTS[param]());
      // Texels beside a page's edges, where a page or a neighbour changes.
      if (params[0] === 't' && k % 2)
        args[0] = (params[1] === 'first' ? args[1] : 0) + EDGES[k % 9];
      assert.equal(shipped[name](...args), scheduler[name](...args), `${name}(${args})`);
    }
  }
});

test('a lamp mip starts past its face’s finer mips, as the table lays them out', () => {
  let offset = 0;
  for (let mip = 0; mip < LAMP_MIPS; mip++) {
    assert.equal(lampMipOffset(mip), offset, `mip ${mip}`);
    assert.equal(PAGES.shadowLampMapEntry(5, mip), 5 * LAMP_FACE_ENTRIES + offset);
    offset += lampPagesAt(mip) ** 2;
  }
  assert.equal(offset, LAMP_FACE_ENTRIES);
});

test('the page a draw composes is the page a read of its square lands in', () => {
  const rect = new Float64Array(4),
    page = (t: number) => PAGES.shadowPageOfTexel(t);
  // A lamp page's crop (`writeLampPage`, `regionRect`) read back through the face's texels.
  for (let mip = 0; mip < LAMP_MIPS; mip++) {
    const pages = lampPagesAt(mip),
      side = pages * SHADOW_PAGE;
    for (let x = 0; x < pages; x++) {
      regionRect(rect, pages, x, x, pages - 1 - x, pages - 1 - x);
      const u = (rect[0] + rect[1]) / 2,
        v = (rect[2] + rect[3]) / 2;
      const t = [PAGES.shadowLampMapTexel(u, side), PAGES.shadowLampMapTexel(-v, side)];
      assert.deepEqual(t.map(page), [x, pages - 1 - x], `mip ${mip} page ${x}`);
      assert.equal(PAGES.shadowLampMapTexel(rect[0], side), x * SHADOW_PAGE);
    }
  }
  // A sun page's square (`writeSunSquare`): `[ax, ax + 1) · S` in the light plane.
  for (let k = 0; k < 2000; k++) {
    const level = int(-12, 12),
      ax = int(-3000, 3000),
      origin = ax - int(0, 63);
    for (const at of [0, 0.5, 1 - 2 ** -20]) {
      const t = PAGES.shadowSunMapTexel((ax + at) * sunPageMetres(level), origin, level);
      assert.equal(page(t), ax - origin, `level ${level} page ${ax} at ${at}`);
    }
  }
});

test('every pass that reads or writes the page table holds the page model once, and no copy of it', () => {
  const opaque = contractLightingShader(true, false);
  for (const [pass, shader] of Object.entries({
    opaque,
    narrow: contractLightingShader(false, true),
    blend: BLEND_SHADER,
    water: WATER_COMPOSITE_SHADER,
    demand: SHADOW_DEMAND_WGSL,
    allocation: ALLOCATION_WGSL,
    fresh: SHADOW_FRESH_WGSL,
  })) {
    assert.equal(shader.split(PAGE_MODEL_WGSL).length, 2, pass);
    for (const name of PAGE_MODEL_FUNCTIONS)
      assert.equal(shader.split(`fn ${name}(`).length, 2, `${pass}: ${name}`);
    assert.doesNotMatch(shader, /LAMP_MIP_OFFSET|floor\(t\/SHADOW_PAGE\)|t-1\.5</, pass);
  }
  // The pages a point reads, one lookup: the shading's and the demand's (`SHADOW_READ_AT_WGSL`).
  for (const [pass, shader] of Object.entries({ opaque, demand: SHADOW_DEMAND_WGSL })) {
    assert.equal(shader.split(SHADOW_READ_AT_WGSL).length, 2, pass);
    // Each map texel formula, sun and lamp: its definition, then its x and y calls in the lookup.
    assert.equal(shader.match(/shadowSunMapTexel\(|shadowLampMapTexel\(/g)?.length, 2 * 3, pass);
  }
});
