import {
  frustumExcludesBox,
  impostorBakedByMesh,
  invertMatrix4,
  planImpostors,
  type ImpostorCard,
  type ImpostorSection,
} from '../../../../sdk-core/src/index.ts';
import { transformAffinePoint } from '../../../../sdk-core/src/math/primitives/vector.ts';
import { hypot3 } from '../../../../sdk-core/src/math/primitives/hypot.ts';
import { impostorCardCorners } from '../../impostor/card.ts';
import { pixelScaleOf } from '../../streaming/priority.ts';
import type { EngineCamera } from '../../camera/world.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { CARD_FLOATS } from './cardWgsl.ts';
import { createImpostorPass, type ImpostorPass } from './pass.ts';

/** One run of cards that share a mesh's atlas: one bind and one instanced draw. */
type CardRun = { group: GPUBindGroup; first: number; count: number };

/** A session's impostor tier on WebGPU: the pass, the baked meshes, and this image's cards. */
export type WebgpuImpostors = ReturnType<typeof createWebgpuImpostors>;

function createWebgpuImpostors(pass: ImpostorPass, section: ImpostorSection) {
  return {
    pass,
    section,
    baked: impostorBakedByMesh(section),
    /** This image's card records, `CARD_FLOATS` each, in draw order. */
    records: new Float32Array(CARD_FLOATS * 16),
    count: 0,
    runs: [] as CardRun[],
    /** The roots this image's cut suppresses, indexed like the roots it planned. */
    switched: undefined as Uint8Array | undefined,
  };
}

/** The session's impostor tier, made by the first image that can draw it: a baked section, the
 *  level reader and the visibility buffer's surfaces. A cache without impostors makes nothing. */
function impostorsOf(rt: WebgpuPagesRuntime): WebgpuImpostors | undefined {
  const section = rt.context.metadata.impostors,
    reader = rt.context.readTextureLevel,
    device = rt.gpu.device;
  if (!rt.vis.visEnabled) return undefined;
  if (rt.gpu.impostors || !section?.baked || !reader || !device) return rt.gpu.impostors;
  const pass = createImpostorPass(device, reader, () => rt.run.gate.resourcesChanged());
  return (rt.gpu.impostors = createWebgpuImpostors(pass, section));
}

const pixelScale = [0, 0],
  pivot = new Float64Array(3),
  corners = new Float64Array(12),
  inverse = new Float64Array(16),
  ordered: ImpostorCard[] = [],
  byMesh = (a: ImpostorCard, b: ImpostorCard) => a.mesh - b.mesh;

/** Writes one card's record at `at`: corners, world, inverse world, shape, object pivot. */
function writeCard(
  out: Float32Array,
  at: number,
  card: ImpostorCard,
  shape: [number, number, number, number],
  centre: readonly number[],
) {
  for (let i = 0; i < 4; i++) {
    out.set(corners.subarray(i * 3, i * 3 + 3), at + i * 4);
    out[at + i * 4 + 3] = 1;
  }
  out.set(card.world as ArrayLike<number>, at + 16);
  out.set(invertMatrix4(inverse, card.world), at + 32);
  out.set(shape, at + 48);
  for (let k = 0; k < 3; k++) out[at + 52 + k] = centre[k];
  out[at + 55] = 1;
}

/**
 * THE IMAGE'S IMPOSTOR PLAN on WebGPU (#1335): `planImpostors` over `roots` at the engine's focal
 * length, then each card kept only once its mesh's atlas is resident — a card still streaming
 * leaves its root to its clusters, so the switch never opens a hole. A kept card outside the view
 * suppresses its root and draws nothing, as the mesh it stands for would; every other is turned to
 * the camera by the shared sprite basis (`impostorCardCorners`) and written to the image's records,
 * grouped by mesh. Returns the roots the cut suppresses, `undefined` with no impostor tier.
 */
export function planWebgpuImpostors(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  roots: readonly ClusterRoot<unknown>[],
) {
  const state = impostorsOf(rt);
  if (!state) return undefined;
  const { feed } = state.pass;
  feed.beginFrame();
  pixelScaleOf(cam.projection, rt.setup.viewport ?? rt.gpu.targetSize, pixelScale);
  const focal = Math.max(pixelScale[0], pixelScale[1]);
  const plan = planImpostors(roots, state.section, cam.view, focal);
  ordered.length = 0;
  for (const card of plan.cards) {
    if (!feed.group(card.mesh, card.maps)) plan.switched[card.root] = 0;
    else ordered.push(card);
  }
  ordered.sort(byMesh);
  state.count = 0;
  state.runs.length = 0;
  if (state.records.length < ordered.length * CARD_FLOATS)
    state.records = new Float32Array(ordered.length * CARD_FLOATS * 2);
  let last: ArrayLike<number> | undefined;
  for (const card of ordered) {
    const entry = state.baked.get(card.mesh)!,
      centre = entry.centre ?? [0, 0, 0],
      R = card.radius;
    // Two primitives of one placement are two roots of one mesh, at one world: one card.
    if (card.world === last) continue;
    last = card.world;
    transformAffinePoint(pivot, card.world, centre[0], centre[1], centre[2]);
    const [x, y, z] = pivot;
    if (frustumExcludesBox(cam.planes, x - R, y - R, z - R, x + R, y + R, z + R)) continue;
    impostorCardCorners(corners, cam.viewProjection, pivot, R);
    // The mip whose texel covers a pixel: the frame side over the card's side in pixels.
    const distance = hypot3(x - cam.eye[0], y - cam.eye[1], z - cam.eye[2]),
      lod = Math.max(0, Math.log2((entry.frameSide * distance) / (2 * R * focal)));
    const shape: [number, number, number, number] = [
      entry.objectRadius ?? entry.radius,
      entry.frames,
      entry.hemi ? 1 : 0,
      lod,
    ];
    writeCard(state.records, state.count * CARD_FLOATS, card, shape, centre);
    const group = feed.group(card.mesh, card.maps)!,
      run = state.runs[state.runs.length - 1];
    if (run?.group === group) run.count++;
    else state.runs.push({ group, first: state.count, count: 1 });
    state.count++;
  }
  state.switched = plan.switched;
  return plan.switched;
}
