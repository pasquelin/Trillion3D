/**
 * The session's side of a partitioned scene (#404): the rows are sized for its camera's reach and
 * the cells that camera needs are read and placed before the engines read the rows
 * (`primePartitions`), and before every frame the cells follow the camera through the session's
 * streamer and active engine (`createPartitionFrame`).
 * The reach is the frame camera's far plane, never a number of the scene's
 * (`../../scene/partition/plan.ts`).
 */
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { FrameBudget } from '../../page/integration/arrivalQueue.ts';
import { resolveCameraWorld, type HostCamera } from '../../camera/world.ts';
import type { PartitionCells } from '../../scene/partition/cells.ts';
import { cellReach } from '../../scene/partition/plan.ts';
import type { createPageStreamer } from '../../streaming/pages.ts';

type Streamer = ReturnType<typeof createPageStreamer>;

/** Where a camera's eye stands in the world. */
function eyeOf(camera: HostCamera) {
  const elements = resolveCameraWorld(camera).matrixWorld.elements;
  return [elements[12], elements[13], elements[14]];
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
  const reach = cellReach(camera);
  const eye = eyeOf(camera);
  const read = (url: string) => streamer.readBytes(url, signal);
  const bytes = await Promise.all(partitions.map((cells) => cells.prime(eye, reach, read, owned)));
  return bytes.reduce((sum, value) => sum + value, 0);
}

type Inputs = {
  partitions: readonly PartitionCells[];
  streamer: Streamer;
  camera: HostCamera;
  active: () => RenderBackend;
  /** The frame's one integration budget, the arrival queue's: cells spend from it before the
   *  drain spends the rest. */
  budget: FrameBudget;
  /** Asked once the camera's reach outgrew the rows sized at open: the owner opens the session
   *  again, sized for it. Absent, a cell past those rows waits. */
  renew?: () => void;
};

/**
 * The step a frame runs before it draws, or `null` when the scene is not partitioned. Its
 * `pending` settles once the cells the last frame asked for within reach are read, true while
 * one of them waits for a frame to place it: a still camera is drawn again until they all are.
 */
export function createPartitionFrame(inputs: Inputs) {
  const { partitions, streamer, camera, active, renew, budget } = inputs;
  if (!partitions.length) return null;
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
    const asked = reads;
    reads = [];
    await Promise.all(asked);
    return later;
  };
  const step = () => {
    const backend = active();
    const io = {
      bytes: (url: string) => streamer.getBytes(url),
      loading: (url: string) => streamer.loading(url),
      request,
      update: (...range: Parameters<NonNullable<RenderBackend['updatePlacements']>>) =>
        backend.updatePlacements?.(...range),
      outgrown: renew,
    };
    const reach = cellReach(camera);
    const eye = eyeOf(camera);
    later = false;
    for (const cells of partitions) later = cells.frame(eye, reach, io, budget) || later;
  };
  return Object.assign(step, { pending });
}
