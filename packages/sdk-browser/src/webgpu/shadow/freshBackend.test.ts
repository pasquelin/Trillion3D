// #1275, on the whole pages backend over a mock GPU that runs the shipped kernels (`runShadowPass`):
// a caster the camera does not select keeps its shadow in the pages the GPU draws itself — its row
// is the engine's own, every resident page of every caster, and the GPU's pair cull keeps it for
// the page its light-space volume reaches, sealed readable in the frame —; a frame at rest runs
// none of the GPU's page work, and a frame where a caster alone moves runs it: the pages its own
// surface asks first are drawn in that frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LAMP } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import {
  PAGE_INDEX_MASK,
  PAGE_VALID,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_TABLE_OFFSET } from '../../gpu/shadow/atlas.ts';
import { along, camera } from '../pages/testScenes.fixture.ts';
import { floorCasterBackend } from './floorCaster.fixture.ts';
import { FRESH_ARG, FRESH_REGION_PAGES } from './freshLayout.ts';
import { POOL_COUNTS } from './poolWgsl.ts';

const GPU_PAGE_WORK = ['composeShadowPages', 'shadowCullPairs', 'sealShadowPages'];

/** The words of the last buffer labelled `label` the mock device made, as they are now. */
type Words = (label: string) => Uint32Array;

async function lampOverFloor() {
  // Two lamps' pages over a 32-pixel screen, whose own read is a pool of four (`screenPoolPages`):
  // the pool is set as a world sets it, at the 256 pages the seed pool held.
  const run = await floorCasterBackend(
    { ...LAMP, position: [0, 0, 4], range: 40 },
    { shadowPoolPages: 256 },
  );
  const words: Words = (label) => {
    const made = run.gpu.buffers.filter((buffer) => buffer.label === label).at(-1)!.data;
    return new Uint32Array(made.buffer, made.byteOffset, made.byteLength >> 2).slice();
  };
  const frame = async () => {
    run.backend.render(camera());
    await run.backend.flush?.();
    await new Promise((settled) => setTimeout(settled, 0));
  };
  return { ...run, words, frame };
}

/** Each time the GPU sealed its pages, what `read` finds then. */
function afterSeal<T>(computes: string[], read: () => T) {
  const seen: T[] = [],
    push = computes.push.bind(computes);
  computes.push = (...entries: string[]) => {
    if (computes.at(-1) === 'sealShadowPages') seen.push(read());
    return push(...entries);
  };
  return seen;
}

test('a caster the camera does not select keeps its shadow in the pages the GPU draws', async () => {
  const { backend, gpu, lights, words, frame } = await lampOverFloor();
  // Twenty metres aside, out of the camera's field.
  backend.setTransform!('caster', along(20));
  await frame();
  const selected = (backend as unknown as { selectedPageIds(): string[] }).selectedPageIds();
  assert.deepEqual(selected, ['1'], 'the camera selects the floor alone');
  // A second lamp over both: its pages are the GPU's to map, and to draw in that frame.
  const seals = afterSeal(gpu.computes, () => ({
    args: words('Trillion3D shadow GPU page draws v1'),
    pairs: words('Trillion3D shadow kept clusters v1'),
    table: words('Trillion3D shadow records and page table v1').subarray(SHADOW_TABLE_OFFSET / 4),
    owner: new Int32Array(words('Trillion3D shadow GPU pool v1').buffer, POOL_COUNTS.length * 4),
  }));
  lights.add({ ...LAMP, id: 'second', position: [10, 0, 6], range: 40 });
  await frame();
  const spheres = new Float32Array(words('Trillion3D cluster spheres v1').buffer);
  const drawn = seals.filter(({ args }) => args[FRESH_ARG.regions] > 0);
  assert.ok(drawn.length > 0, 'the GPU draws the pages it mapped');
  const casterPages = drawn.flatMap(({ args, pairs, table, owner }) => {
    const kept = args[FRESH_ARG.pairs],
      pages: number[] = [];
    // The rows the engine's cull kept: the caster's is the one twenty metres aside.
    for (let i = 0; i < kept; i++) {
      const [k, row] = [pairs[2 * i], pairs[2 * i + 1]];
      if (spheres[4 * row] < 10) continue;
      const page = args[FRESH_REGION_PAGES + k];
      assert.equal(table[owner[page]] & (PAGE_VALID | PAGE_INDEX_MASK), PAGE_VALID | page);
      pages.push(page);
    }
    return pages;
  });
  assert.ok(casterPages.length > 0, 'a page the GPU drew keeps the caster, readable');
});

test('a frame at rest runs none of the GPU page work; one where a caster alone moves runs it', async () => {
  const { backend, gpu, frame } = await lampOverFloor();
  for (let warm = 0; warm < 3; warm++) await frame();
  assert.ok(
    gpu.computes.some((entry) => GPU_PAGE_WORK.includes(entry)),
    'the first frames run it',
  );
  for (let rest = 0; rest < 4; rest++) await frame();
  const work = async (act?: () => void) => {
    const computes = gpu.computes.length,
      passes = gpu.passes.length;
    act?.();
    await frame();
    return [
      gpu.computes.slice(computes).filter((entry) => GPU_PAGE_WORK.includes(entry)).length,
      gpu.passes.slice(passes).filter(({ label }) => label === 'Trillion3D shadow atlas v1').length,
    ];
  };
  assert.deepEqual(await work(), [0, 0], 'at rest: no GPU page work, no pass over a layer');
  for (const x of [0.05, 0.1, 0.15]) {
    const [computes, passes] = await work(() => backend.setTransform!('caster', along(x)));
    assert.ok(computes > 0 && passes > 0, `the caster at ${x}: the GPU draws what it asks first`);
  }
  assert.deepEqual(await work(), [0, 0], 'at rest again: none of it');
});
