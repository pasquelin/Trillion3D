/**
 * The session's side of a partitioned scene (#404): the rows are sized for its camera's reach and
 * the cells that camera needs are read and placed before the engines read the rows
 * (`primePartitions`), and before every frame the cells follow the camera through the session's
 * streamer and active engine (`createPartitionFrame`), the meshes whose primitive the view read
 * since mounted in place (`partitionMounts.ts`, #751).
 * The reach is the frame camera's far plane, never a number of the scene's
 * (`../../scene/partition/plan.ts`).
 */
import { maxStretch } from '../../../../sdk-core/src/index.ts';
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { FrameBudget } from '../../page/integration/frameBudget.ts';
import { resolveCameraWorld, type HostCamera } from '../../camera/world.ts';
import type { PartitionCells } from '../../scene/partition/cells.ts';
import { cellReach } from '../../scene/partition/plan.ts';
import type { createPageStreamer } from '../../streaming/pageStreamer.ts';
import { growsInPlaceOf } from '../../placement/backendSceneUpdates.ts';
import { createPartitionMounts } from './partitionMounts.ts';

type Streamer = ReturnType<typeof createPageStreamer>;

/** Where a camera's eye stands in the world, and its reach there: the frustum its world matrix
 *  poses, which a scaled camera — or one under a scaled rig — stretches by up to its largest
 *  singular value (`maxStretch`). */
function viewOf(camera: HostCamera) {
  const elements = resolveCameraWorld(camera).matrixWorld.elements;
  return {
    eye: [elements[12], elements[13], elements[14]],
    reach: cellReach(camera) * maxStretch(elements),
  };
}

/**
 * Sizes the rows for `camera`'s reach — for every cell when no owner can open the session again
 * (`owned` false) —, then reads and places the cells it needs, each through the streamer at the
 * head of its queue; resolves with the bytes read.
 */
export async function primePartitions(
  partitions: readonly PartitionCells[],
  camera: HostCamera,
  streamer: Streamer,
  owned: boolean,
  signal?: AbortSignal,
) {
  const { eye, reach } = viewOf(camera);
  const read = (url: string) => streamer.readBytes(url, signal);
  const bytes = await Promise.all(partitions.map((cells) => cells.prime(eye, reach, read, owned)));
  return bytes.reduce((sum, value) => sum + value, 0);
}

type Inputs = {
  partitions: readonly PartitionCells[];
  streamer: Streamer;
  camera: HostCamera;
  active: () => RenderBackend;
  /** The session's one integration budget per frame (`BackendContext.frameBudget`): cells spend
   *  from it before the arrival drain and the engine's row records spend the rest. */
  budget: FrameBudget;
  /** What the session opened on (`partitionMounts.ts`). */
  opened?: Parameters<typeof createPartitionMounts>[0]['opened'];
  /** Asked once the camera's reach, or a parent's stretch, outgrew the rows sized at open on an
   *  engine that grows no buffer in place, or a mesh the view read cannot be mounted in place:
   *  the owner opens the session again. Absent, a cell past those rows waits. */
  renew?: () => void;
};

/**
 * The step a frame runs before it draws, or `null` when the scene is not partitioned. Its
 * `pending` settles once the cells the last frame asked for within reach are read, and the
 * manifest pages and mounts they asked (#751), true while one of them waits for a frame to place
 * or mount it, or a mount landed: a still camera is drawn again until they all are.
 */
export function createPartitionFrame(inputs: Inputs) {
  const { partitions, streamer, camera, active, renew, budget } = inputs;
  if (!partitions.length) return null;
  const mounts = createPartitionMounts({ partitions, opened: inputs.opened, active, renew });
  let reads: Promise<void>[] = [],
    later = false;
  const request = (urls: readonly string[], ahead: boolean) => {
    // A read that fails is said by the streamer's own diagnostics; the cell is asked again later.
    const priority = ahead ? PRIORITY_PREFETCH : PRIORITY_VISIBLE;
    const read = streamer.request(urls, { priority }).then(
      () => {},
      () => {},
    );
    if (!ahead) reads.push(read);
  };
  const pending = async () => {
    const asked = reads,
      turned = [...mounts.asked(), ...partitions.flatMap((cells) => cells.manifest.reads())];
    reads = [];
    await Promise.all([...asked, ...turned]);
    return later || turned.length > 0 || mounts.stale();
  };
  const step = () => {
    mounts.sync();
    const backend = active();
    const io: Parameters<PartitionCells['frame']>[2] = {
      bytes: (url: string) => streamer.getBytes(url),
      loading: (url: string) => streamer.loading(url),
      request,
      update: (...range: Parameters<NonNullable<RenderBackend['updatePlacements']>>) =>
        backend.updatePlacements?.(...range),
      grow: backend.growPlacements && {
        growPlacements: backend.growPlacements.bind(backend),
        growsInPlace: (from, capacity) => growsInPlaceOf(backend, from, capacity),
      },
      outgrown: renew,
    };
    const { eye, reach } = viewOf(camera);
    later = false;
    for (const cells of partitions) later = cells.frame(eye, reach, io, budget) || later;
  };
  return Object.assign(step, { pending });
}
