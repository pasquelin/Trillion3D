// The "transparents in a few orders" bench scene and its frames: twelve placements per
// paged prototype, a few primitives that carry their own buffers, and three camera
// regimes. Both sides of the bench each build a copy, so neither benefits from the
// state the other leaves.
import * as THREE from 'three';
import {
  createWebgpuBlendState,
  type BlendGpuItem,
} from '../../../../packages/sdk-browser/webgpuBlendState.ts';
import {
  buildBlendStatics,
  refreshBlendPlan,
} from '../../../../packages/sdk-browser/webgpuBlendPlan.ts';
import { graine } from '../../../core/index.ts';
import { planReference } from '../../../oracles/browser/transparents-ordres.ts';

type BlendState = ReturnType<typeof createWebgpuBlendState>;

/** The reduced item this bench builds: only the fields the blend order reads (no GPU buffers). */
export interface BenchItem {
  material: THREE.Material;
  matrix: THREE.Matrix4;
  bounds: Float64Array;
  count: number;
  paged: boolean;
  pagedIndex: number | undefined;
  tableBase: number;
}

/** Order of magnitude of the measured scene: 4 288 transparent items, twelve placements each. */
const PLACEMENTS = 12,
  PROTOTYPES = 357,
  ISOLES = 4,
  PAGINES = PROTOTYPES * PLACEMENTS;
export const ITEMS = PAGINES + ISOLES;
/** What a paged primitive holds in the catalogue, and the vertices of a cluster. */
const GRAPPES = 8,
  MOTS = 48;

const alea = graine(31);

/**
 * Both sides of a transparent scene, and why the bench measures both.
 *
 * `sidesOf` yields ONE plan entry for a single-sided material, and TWO — back then front, two
 * pipelines — for a double-sided material. A slice stops when the pipeline changes: a
 * double-sided scene, the glass and foliage of an ordinary glTF scene, therefore merges
 * none. Measuring only the single-sided scene is measuring the best case and publishing it as
 * if it were the case.
 */
export const FACES: [string, THREE.Side][] = [
  ['single-sided', THREE.FrontSide],
  ['double-sided', THREE.DoubleSide],
];

/**
 * The scene: twelve placements per prototype, plus four primitives that carry their buffers.
 * Reduced fixture: only the fields the blend order reads are populated (no real GPU buffers).
 */
function batisItems(side: THREE.Side): BenchItem[] {
  const items: BenchItem[] = [],
    materiau = new THREE.MeshBasicMaterial({ side });
  for (let i = 0; i < ITEMS; i++) {
    const paged = i < PAGINES;
    const matrix = new THREE.Matrix4().setPosition(
      (i % 64) * 3 - 96,
      ((i >> 6) % 16) * 4,
      Math.floor(i / 1024) * 5,
    );
    const m = matrix.elements;
    const bounds = new Float64Array([
      m[12] - 1,
      m[13] - 1,
      m[14] - 1,
      m[12] + 1,
      m[13] + 1,
      m[14] + 1,
    ]);
    items.push({
      material: materiau,
      matrix,
      bounds,
      count: paged ? 0 : 900,
      paged,
      pagedIndex: paged ? i : undefined,
      tableBase: paged ? i * GRAPPES : 0,
    });
  }
  return items;
}

/** The six half-spaces of a box centred on the eye: the frustum rule, without projection. */
function plansDe(x: number): Float64Array {
  const planes = new Float64Array(24);
  const pose = (p: number, a: number, b: number, c: number, d: number) => {
    planes[p * 4] = a;
    planes[p * 4 + 1] = b;
    planes[p * 4 + 2] = c;
    planes[p * 4 + 3] = d;
  };
  pose(0, 1, 0, 0, 110 - x);
  pose(1, -1, 0, 0, 110 + x);
  pose(2, 0, 1, 0, 40);
  pose(3, 0, -1, 0, 40);
  pose(4, 0, 0, 1, 400);
  pose(5, 0, 0, -1, 400);
  return planes;
}

/** A frame: the eye, its planes, and the cut compaction would have written for each item. */
function imageA(x: number) {
  const counts = new Uint32Array(PAGINES),
    instances = new Uint32Array(PAGINES * GRAPPES);
  for (let p = 0; p < counts.length; p++) {
    const tenues = 1 + Math.floor(alea() * GRAPPES);
    counts[p] = tenues;
    for (let j = 0; j < tenues; j++) instances[p * GRAPPES + j] = p * GRAPPES + j;
  }
  return { eye: [x, 8, 0], planes: plansDe(x), counts, instances };
}
export type Frame = ReturnType<typeof imageA>;

/**
 * Three regimes, eight frames each: the sliding camera — the round trip closes the loop, so
 * a lap does not chain onto a disguised jump —, the still pose, and the camera jump,
 * which fully renews the paint order.
 */
export const glisse: Frame[] = [0, 6, 12, 18, 24, 18, 12, 6].map(imageA);
export const regimes: [string, Frame[]][] = [
  ['sliding camera', glisse],
  ['still pose', Array.from({ length: 8 }, () => glisse[0])],
  ['camera jump', Array.from({ length: 8 }, (_, image) => imageA(image * 47 - 160))],
];

/** The span of each cluster in the page cache: the same table on both sides. */
export const spans = new Uint32Array(PAGINES * GRAPPES * 2);
for (let e = 0; e < spans.length / 2; e++) {
  spans[e * 2] = e * MOTS;
  spans[e * 2 + 1] = MOTS;
}

/** One side of the bench: its blend state, its plan in the old format, and its output buffers. */
export function benchSide(side: THREE.Side) {
  const blendState: BlendState = createWebgpuBlendState();
  // Reduced fixture, matching the pattern already used by `webgpuBlendPlan.test.ts`: only the
  // fields the blend order reads are populated, not a full GPU `BlendGpuItem`.
  blendState.blendGpu.push(...(batisItems(side) as unknown as BlendGpuItem[]));
  blendState.table = {
    maxVertexWords: MOTS,
    capacity: PAGINES * GRAPPES,
    length: PAGINES * GRAPPES,
    itemRanges: Uint32Array.from({ length: PAGINES * 2 }, (_, k) =>
      k % 2 ? GRAPPES : (k >> 1) * GRAPPES,
    ),
  } as BlendState['table'];
  buildBlendStatics(blendState);
  refreshBlendPlan(blendState);
  return {
    blendState,
    // The previous path's plan, in its own format: the batch put the share bit in the entry.
    order: planReference(blendState.blendGpu),
    scene: {
      items: blendState.blendGpu,
      draws: blendState.drawsPacked,
      planes: blendState.blendPlanes,
      spans,
      itemCounts: undefined as Uint32Array | undefined,
      instances: undefined as Uint32Array | undefined,
    },
    args: new Uint32Array(ITEMS * 4),
    // A double-sided item spreads its instances twice: one per plan entry.
    output: new Uint32Array((PAGINES * GRAPPES + ISOLES) * 3 * 2),
  };
}
export type BenchSide = ReturnType<typeof benchSide>;

/** What the frame gives both sides: the frustum planes and this frame's cut. */
export function pose(etat: BenchSide, image: Frame) {
  etat.blendState.blendPlanes.set(image.planes);
  etat.scene.itemCounts = image.counts;
  etat.scene.instances = image.instances;
  etat.blendState.cpuItemCounts = image.counts;
  etat.blendState.cpuInstances = image.instances;
}
