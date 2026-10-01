import {
  frustumExcludesBox,
  impostorBakedByMesh,
  impostorTexelDepth,
  invertMatrix4,
  planImpostors,
  type ImpostorCard,
  type ImpostorPlan,
  type ImpostorSection,
} from '../../../../sdk-core/src/index.ts';
import { transformAffinePoint } from '../../../../sdk-core/src/math/primitives/vector.ts';
import { hypot3 } from '../../../../sdk-core/src/math/primitives/hypot.ts';
import { impostorCardCorners } from '../../impostor/card.ts';
import { pixelScaleOf } from '../../streaming/priority.ts';
import { markCard } from '../../visibility/shader/spriteWgsl.ts';
import { markReach } from '../../deformation/halfFloat.ts';
import { grownCapacity } from '../../placement/rows.ts';
import type { EngineCamera } from '../../camera/world.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { CARD_FLOATS } from './cardWgsl.ts';
import { createImpostorPass, type ImpostorPass } from './pass.ts';
import { constrainStereoImpostors } from './stereo.ts';

/** One run of cards that share a mesh's atlas: one bind and one instanced draw. */
type CardRun = { group: GPUBindGroup; first: number; count: number };

/** A session's impostor tier on WebGPU: the pass, the baked meshes, and this image's cards. */
export type WebgpuImpostors = ReturnType<typeof createWebgpuImpostors>;

function createWebgpuImpostors(pass: ImpostorPass, section: ImpostorSection) {
  return {
    pass,
    section,
    baked: impostorBakedByMesh(section),
    /** The plan, planned again in place every image (`planImpostors`' `into`). */
    plan: undefined as ImpostorPlan | undefined,
    stereoPlan: undefined as ImpostorPlan | undefined,
    /** This image's card records, `CARD_FLOATS` each, in draw order. */
    records: new Float32Array(CARD_FLOATS * 16),
    count: 0,
    /** This image's runs, `runs[0 .. runCount)`; the objects past it are kept for later images. */
    runs: [] as CardRun[],
    runCount: 0,
  };
}

/** The session's impostor tier, made by the first image that can draw it: a baked section, the
 *  level reader and the visibility buffer's surfaces. A cache without impostors makes nothing. */
function impostorsOf(rt: WebgpuPagesRuntime): WebgpuImpostors | undefined {
  const section = rt.context.metadata.impostors,
    reader = rt.context.readTextureLevel,
    device = rt.gpu.device;
  if (!rt.vis.visEnabled) return undefined;
  if (rt.gpu.impostors) return rt.gpu.impostors;
  if (!section?.baked || !reader || !device) return undefined;
  const { setup, vis, diag } = rt;
  const pass = createImpostorPass(device, reader, {
    // What the one texture budget leaves beside the pool's floor and the live textures.
    room: () =>
      setup.texturePoolBudget -
      (setup.texturePools?.poolFor(1).allocatedBytes ?? 0) -
      (vis.textures?.sources.liveBytes ?? 0),
    landed: () => rt.run.gate.resourcesChanged(),
    onFailure: diag.diagnosticFailure,
  });
  return (rt.gpu.impostors = createWebgpuImpostors(pass, section));
}

const pixelScale = [0, 0],
  pivot = new Float64Array(3),
  corners = new Float64Array(12),
  inverse = new Float64Array(16),
  byMesh = (a: ImpostorCard, b: ImpostorCard) => a.mesh - b.mesh;

/** Writes one card's record at `at`: corners, world, inverse world, shape, object pivot. */
function writeCard(
  out: Float32Array,
  at: number,
  card: ImpostorCard,
  shape: readonly [radius: number, frames: number, hemi: number, lod: number],
  centre: readonly number[],
) {
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

/** Sets each root's card bit to the plan's verdict (`markCard`), and hands the roots whose bit
 *  moved to the GPU cut (`markWorld`), their reach kept: one decision for both cuts. */
function markCards(
  rt: WebgpuPagesRuntime,
  roots: readonly ClusterRoot<unknown>[],
  switched: Uint8Array | undefined,
) {
  for (let rank = 0; rank < roots.length; rank++) {
    const root = roots[rank];
    if (markCard(root, switched?.[rank] === 1))
      rt.run.gpuSelection?.markWorld(rank, markReach(root.mark ?? 0, root.reach ?? 0));
  }
}

const shape: [number, number, number, number] = [0, 0, 0, 0],
  ORIGIN = [0, 0, 0] as const;

/**
 * THE IMAGE'S IMPOSTOR PLAN on WebGPU (#1335): `planImpostors` over the cut's roots at the engine's
 * focal length, planned again in place. A card outside the view suppresses its root and asks
 * nothing, as the mesh it stands for would draw nothing: residency follows the view. A card in it is
 * kept only once its mesh's atlas is resident — one still streaming leaves its root to its
 * clusters, so the switch never opens a hole —, turned to the camera by the shared sprite basis
 * (`impostorCardCorners`) and written to the image's records, grouped by mesh. The verdict marks
 * each root (`CARD_ROOT`): every camera cut, CPU and GPU, leaves a marked root to its card, every
 * light cut keeps its clusters, so the object casts its mesh's shadow.
 */
export function planWebgpuImpostors(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const roots = rt.layout.selectionRoots,
    state = impostorsOf(rt);
  if (!state) {
    // A tier the visibility buffer's drop turned off suppresses nothing and draws nothing.
    const stale = rt.gpu.impostors;
    if (!stale?.plan) return;
    stale.count = stale.runCount = 0;
    stale.plan = undefined;
    markCards(rt, roots, undefined);
    return;
  }
  const { feed } = state.pass,
    frame = rt.run.frame;
  pixelScaleOf(cam.projection, rt.setup.viewport ?? rt.gpu.targetSize, pixelScale);
  const focal = Math.max(pixelScale[0], pixelScale[1]);
  const plan = (state.plan = planImpostors(roots, state.section, cam.view, focal, state.plan));
  state.stereoPlan = constrainStereoImpostors(
    roots,
    state.section,
    rt.context.stereo?.views,
    plan,
    state.stereoPlan,
  );
  plan.cards.sort(byMesh);
  state.count = state.runCount = 0;
  const floats = plan.cards.length * CARD_FLOATS;
  if (state.records.length < floats)
    state.records = new Float32Array(grownCapacity(state.records.length, floats));
  let last: ArrayLike<number> | undefined,
    mesh = -1,
    group: GPUBindGroup | undefined;
  for (const card of plan.cards) {
    if (!plan.switched[card.root]) continue;
    const entry = state.baked.get(card.mesh)!,
      centre = entry.centre ?? ORIGIN,
      R = card.radius;
    transformAffinePoint(pivot, card.world, centre[0], centre[1], centre[2]);
    const x = pivot[0],
      y = pivot[1],
      z = pivot[2];
    if (frustumExcludesBox(cam.planes, x - R, y - R, z - R, x + R, y + R, z + R)) continue;
    if (card.mesh !== mesh) {
      group = feed.group((mesh = card.mesh), card.maps, frame);
      last = undefined;
    }
    if (!group) {
      plan.switched[card.root] = 0;
      continue;
    }
    // Two primitives of one placement are two roots of one mesh, at one world: one card.
    if (card.world === last) continue;
    last = card.world;
    impostorCardCorners(corners, cam.viewProjection, pivot, R);
    // The mip whose texel covers a pixel: the distance over the depth of one texel a pixel.
    const distance = hypot3(x - cam.eye[0], y - cam.eye[1], z - cam.eye[2]);
    shape[0] = entry.objectRadius ?? entry.radius;
    shape[1] = entry.frames;
    shape[2] = entry.hemi ? 1 : 0;
    shape[3] = Math.max(0, Math.log2(distance / impostorTexelDepth(R, entry.frameSide, focal)));
    writeCard(state.records, state.count * CARD_FLOATS, card, shape, centre);
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
  markCards(rt, roots, plan.switched);
}
