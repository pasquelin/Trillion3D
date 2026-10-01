/**
 * THE IMAGE'S IMPOSTOR CARDS, one plan for both GPU paths (#1335, #1336): `planImpostors` over the
 * cut's roots at the engine's focal length, planned again in place, then each card the image draws
 * written as one record, grouped by mesh into runs that share an atlas. WebGPU binds a run's atlas
 * as a bind group (`webgpu/impostor/`), WebGL2 as three textures (`webgl/impostor/`): `G` is that
 * binding, and `atlasOf` answers it once the mesh's atlas is resident — asking it otherwise.
 */
import {
  frustumExcludesBox,
  impostorBakedByMesh,
  impostorTexelDepth,
  invertMatrix4,
  planImpostors,
  type ImpostorCard,
  type ImpostorMaps,
  type ImpostorPlan,
  type ImpostorSection,
} from '../../../sdk-core/src/index.ts';
import { transformAffinePoint } from '../../../sdk-core/src/math/primitives/vector.ts';
import { hypot3 } from '../../../sdk-core/src/math/primitives/hypot.ts';
import { impostorCardCorners } from './card.ts';
import { core } from './borrowed.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { ClusterRoot } from '../page/selection/types.ts';

/** Floats of one card record: four corners, world, inverse world, shape, object pivot. */
export const CARD_FLOATS = 56;

/**
 * Coverage below which a card texel is no surface: the engine's default alpha cutoff, the one a
 * masked material without its own declares (`MASK_CUTOFF`, the world API's: not imported into the
 * shader layer). The bake stores coverage, never a cut, so the cut is the runtime's; a mesh whose
 * material declares another keeps it on its own clusters.
 */
export const CARD_COVERAGE_CUT = 0.5;

/** One run of cards that share a mesh's atlas: one bind and one instanced draw. */
type CardRun<G> = { group: G; first: number; count: number };

/** A session's cards: the baked meshes and this image's plan, records and runs. */
export function createImpostorCards<G>(section: ImpostorSection) {
  return {
    section,
    baked: impostorBakedByMesh(section),
    /** The plan, planned again in place every image (`planImpostors`' `into`). */
    plan: undefined as ImpostorPlan | undefined,
    /** This image's card records, `CARD_FLOATS` each, in draw order. */
    records: new Float32Array(CARD_FLOATS * 16),
    count: 0,
    /** This image's runs, `runs[0 .. runCount)`; the objects past it are kept for later images. */
    runs: [] as CardRun<G>[],
    runCount: 0,
  };
}

export type ImpostorCards<G> = ReturnType<typeof createImpostorCards<G>>;
/** Told of each root whose card bit moved: the GPU cut's copy of the mark follows it. */
export type CardMoved = (rank: number, root: ClusterRoot<unknown>) => void;

const pixelScale = [0, 0],
  pivot = new Float64Array(3),
  corners = new Float64Array(12),
  inverse = new Float64Array(16),
  shape: [number, number, number, number] = [0, 0, 0, 0],
  ORIGIN = [0, 0, 0] as const,
  byMesh = (a: ImpostorCard, b: ImpostorCard) => a.mesh - b.mesh;

/** Writes one card's record at `at`: corners, world, inverse world, shape, object pivot. */
function writeCard(out: Float32Array, at: number, card: ImpostorCard, centre: readonly number[]) {
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3; k++) out[at + i * 4 + k] = corners[i * 3 + k];
    out[at + i * 4 + 3] = 1;
  }
  out.set(card.world as ArrayLike<number>, at + 16);
  out.set(invertMatrix4(inverse, card.world), at + 32);
  out.set(shape, at + 48);
  for (let k = 0; k < 3; k++) out[at + 52 + k] = centre[k];
  out[at + 55] = 1;
}

/** Sets each root's card bit to the plan's verdict (`markCard`); `moved` hears the roots whose bit
 *  moved. One decision for every cut. */
function markImpostorRoots(
  roots: readonly ClusterRoot<unknown>[],
  switched: Uint8Array | undefined,
  moved?: CardMoved,
) {
  for (let rank = 0; rank < roots.length; rank++) {
    const root = roots[rank];
    if (core.markCard(root, switched?.[rank] === 1)) moved?.(rank, root);
  }
}

/** A tier turned off (its path's drop): no card, and every root its clusters again. */
export function dropImpostorCards<G>(
  state: ImpostorCards<G> | undefined,
  roots: readonly ClusterRoot<unknown>[],
  moved?: CardMoved,
) {
  if (!state?.plan) return;
  state.count = state.runCount = 0;
  state.plan = undefined;
  markImpostorRoots(roots, undefined, moved);
}

/**
 * THE IMAGE'S IMPOSTOR PLAN: `planImpostors` over `roots` at the engine's focal length for
 * `viewport`. A card outside the view suppresses its root and asks nothing, as the mesh it stands
 * for would draw nothing: residency follows the view. A card in it is kept only once its mesh's
 * atlas is resident (`atlasOf`) — one still streaming leaves its root to its clusters, so the switch
 * never opens a hole —, turned to the camera by the shared sprite basis (`impostorCardCorners`) and
 * written to the image's records, grouped by mesh. The verdict marks each root (`CARD_ROOT`): every
 * camera cut leaves a marked root to its card, every light cut keeps its clusters, so the object
 * casts its mesh's shadow.
 */
export function planImpostorCards<G>(
  state: ImpostorCards<G>,
  roots: readonly ClusterRoot<unknown>[],
  cam: EngineCamera,
  viewport: readonly number[] | undefined,
  atlasOf: (mesh: number, maps: ImpostorMaps) => G | undefined,
  moved?: CardMoved,
) {
  core.pixelScaleOf(cam.projection, viewport, pixelScale);
  const focal = Math.max(pixelScale[0], pixelScale[1]);
  const plan = (state.plan = planImpostors(roots, state.section, cam.view, focal, state.plan));
  plan.cards.sort(byMesh);
  state.count = state.runCount = 0;
  const floats = plan.cards.length * CARD_FLOATS;
  if (state.records.length < floats)
    state.records = new Float32Array(core.grownCapacity(state.records.length, floats));
  let last: ArrayLike<number> | undefined,
    mesh = -1,
    group: G | undefined;
  for (const card of plan.cards) {
    const entry = state.baked.get(card.mesh)!,
      centre = entry.centre ?? ORIGIN,
      R = card.radius;
    // Two primitives of one placement are two roots of one mesh, at one world: one card, the
    // verdict of the first.
    if (card.mesh === mesh && card.world === last) continue;
    transformAffinePoint(pivot, card.world, centre[0], centre[1], centre[2]);
    const x = pivot[0],
      y = pivot[1],
      z = pivot[2];
    if (frustumExcludesBox(cam.planes, x - R, y - R, z - R, x + R, y + R, z + R)) continue;
    if (card.mesh !== mesh) {
      group = atlasOf((mesh = card.mesh), card.maps);
      last = undefined;
    }
    if (group === undefined) {
      plan.switched[card.root] = 0;
      continue;
    }
    last = card.world;
    impostorCardCorners(corners, cam.viewProjection, pivot, R);
    // The mip whose texel covers a pixel: the distance over the depth of one texel a pixel.
    const distance = hypot3(x - cam.eye[0], y - cam.eye[1], z - cam.eye[2]);
    shape[0] = entry.objectRadius ?? entry.radius;
    shape[1] = entry.frames;
    shape[2] = entry.hemi ? 1 : 0;
    shape[3] = Math.max(0, Math.log2(distance / impostorTexelDepth(R, entry.frameSide, focal)));
    writeCard(state.records, state.count * CARD_FLOATS, card, centre);
    const run = state.runCount ? state.runs[state.runCount - 1] : undefined;
    if (run?.group === group) run.count++;
    else {
      const next = (state.runs[state.runCount++] ??= { group, first: 0, count: 0 });
      next.group = group;
      next.first = state.count;
      next.count = 1;
    }
    state.count++;
  }
  markImpostorRoots(roots, plan.switched, moved);
}
