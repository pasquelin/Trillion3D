// Bounded by the view, not by the world (#483 rule 6, #486): the cut's host tables on every backend
// weigh the same for a world and for the same world sixteen times larger, seen from the same view
// with the same pool. The view sees the first placement, which the pool holds whole; every other
// placement lies behind the camera, with nothing resident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDag } from './cutRule.fixture.ts';
import { stripCamera } from './cutRuleBackends.fixture.ts';
import { selectVisiblePages } from './cut.ts';
import { heldHostBytes } from './held.ts';
import { createGroupClosure } from './groupClosure.ts';
import { packDagSelection } from '../../gpu/dag/pack.ts';
import { uploadResidency } from '../../gpu/dag/readiness.fixture.ts';
import { createAutonomousRequests } from '../../backend/autonomous/requests.ts';
import { createCutDelta } from '../../webgpu/cut/delta.ts';
import { createCutPending } from '../../webgpu/cut/pending.ts';
import { createWebgpuPageTracking } from '../../webgpu/row/pageTracking.ts';
import { createWebgpuResidencySets } from '../../webgpu/residency/sets.ts';
import { IDENTITY_ELEMENTS } from '../../math/matrixElements.ts';
import type { ClusterRoot, PageRec } from '../selection/types.ts';

const dag = ruleDag(64),
  n = dag.pages.length;

/** `copies` placements of the DAG along -x, each a strip of its own pages; the first is in view. */
function world(copies: number) {
  const roots = Array.from({ length: copies }, (_, r) => {
    const elements = Float64Array.from(IDENTITY_ELEMENTS);
    elements[12] = -1e5 * r;
    const pages = dag.pages.map((page, p) => ({
      ...page,
      url: `r${r}/${page.url}`,
      placementIndex: r,
      packedIndex: r * n + p,
    }));
    const worldBox = r ? Float64Array.of(-1e5 * r, -2, -2, -1e5 * r + 64, 2, 2) : undefined;
    return { world: { elements }, pages, culling: dag.culling, structure: dag.structure, worldBox };
  }) as unknown as ClusterRoot<PageRec>[];
  const packed = roots.flatMap((root) => root.pages);
  const inView = (page: PageRec) => page.placementIndex === 0;
  return { roots, packed, inView };
}

/** The host tables of every backend, after the same frame of the same view. */
function tables(copies: number) {
  const { roots, packed, inView } = world(copies);
  const ids = (list: readonly PageRec[]) => list.map((page) => page.packedIndex!);
  // The CPU cut — the WebGPU CPU path and the WebGL2 image — with the pool holding the view.
  const cut = selectVisiblePages(roots, stripCamera(dag), {
    pixelError: 0.1,
    viewport: [1280, 720],
    holdResident: true,
    isResident: inView,
  });
  assert.ok(cut.wanted.length > 0 && cut.wanted.every(inView), 'the view wants its placement');
  const cpuReadiness = roots.reduce((bytes, root) => bytes + heldHostBytes(root), 0);
  // The GPU kernel's host: the rule's readiness and its upload's change lists.
  const gpuPacked = packDagSelection(roots);
  const gpuReadiness = uploadResidency(
    gpuPacked,
    Uint8Array.from(packed, (page) => (inView(page) ? 1 : 0)),
  ).hostBytes;
  // WebGPU: the cut's differences, its closure, the residency sets and the pending set.
  const cutDelta = createCutDelta(packed),
    drawnDelta = createCutDelta(packed);
  cutDelta.apply(ids(cut.wanted));
  drawnDelta.apply(ids(cut.shown));
  const closure = createGroupClosure(roots, packed);
  closure.apply(cutDelta);
  const tracking = createWebgpuPageTracking(packed);
  const sets = createWebgpuResidencySets({
    tracking,
    bootstrapKey: new Uint8Array(tracking.keyCount),
    packedPages: packed,
  });
  sets.applyCut(closure.delta);
  sets.applyDrawn(drawnDelta);
  sets.applyBudget(1 << 20);
  const pending = createCutPending(packed, closure.delta);
  pending.apply();
  assert.ok(pending.count > 0, 'the view awaits its pages');
  // WebGL2: the requests closed over their groups.
  const requests = createAutonomousRequests(roots, () => 0, []);
  requests.of(cut.wanted);
  return {
    'CPU cut readiness (page/cut/held.ts)': cpuReadiness,
    'GPU readiness and upload (gpu/dag/readiness.ts)': gpuReadiness,
    'group closure (page/cut/groupClosure.ts)': closure.hostBytes,
    'cut differences (webgpu/cut/delta.ts)': cutDelta.hostBytes + drawnDelta.hostBytes,
    'residency and tracking sets (webgpu/residency/sets.ts)': sets.hostBytes,
    'pending set and its named records (webgpu/cut/pending.ts)': pending.hostBytes,
    'WebGL2 group closure (backend/autonomous/requests.ts)': requests.hostBytes,
  };
}

test('every cut host table weighs the same for a world and for the world sixteen times larger', () => {
  const small = tables(2),
    large = tables(32);
  for (const [table, bytes] of Object.entries(small)) {
    assert.equal(typeof bytes, 'number', `${table}: its bytes are counted`);
    assert.ok(bytes > 0, `${table}: the view holds something`);
    assert.equal(large[table as keyof typeof large], bytes, `${table}: 1x and 16x differ`);
  }
});

test("a placement's readiness follows what the pool holds of it, not its size", () => {
  // One placement sixteen times finer, the pool holding its roots alone in both cases.
  const bytes = (leaves: number) => {
    const strip = ruleDag(leaves),
      root = {
        world: strip.world,
        pages: strip.pages,
        culling: strip.culling,
        structure: strip.structure,
      };
    const roots = strip.pages.filter((page) => page.group === null);
    selectVisiblePages([root as unknown as ClusterRoot<PageRec>], stripCamera(strip), {
      pixelError: 0.1,
      viewport: [1280, 720],
      holdResident: true,
      isResident: (page) => roots.includes(page as never),
    });
    const gpu = uploadResidency(
      packDagSelection([root as unknown as ClusterRoot<PageRec>]),
      Uint8Array.from(strip.pages, (page) => (page.group === null ? 1 : 0)),
    );
    return { roots: roots.length, cpu: heldHostBytes(root), gpu: gpu.hostBytes };
  };
  const small = bytes(64),
    large = bytes(1024);
  assert.equal(small.roots, large.roots, 'the same root cover');
  assert.ok(small.cpu > 0);
  assert.deepEqual(large, small);
});
