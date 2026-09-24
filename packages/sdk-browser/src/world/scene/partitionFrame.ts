/**
 * The session's side of a partitioned scene (#404): the cells its first camera needs are read and
 * placed before the engines read the rows (`primePartitions`), and before every frame the cells
 * follow the camera through the session's streamer and active engine (`createPartitionFrame`).
 * The reach of a cell is the frame's own — its camera, its drawn height, its error target —
 * never a number of the scene's (`../../scene/partition/plan.ts`).
 */
import { ARRIVAL_BUDGET_MS } from '../../backend/common.ts';
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { resolveCameraWorld, type HostCamera } from '../../camera/world.ts';
import type { PartitionCells } from '../../scene/partition/cells.ts';
import { cellReach, type PartitionOptics } from '../../scene/partition/plan.ts';
import type { createPageStreamer } from '../../streaming/pages.ts';

type Streamer = ReturnType<typeof createPageStreamer>;

/** Where a camera's eye stands in the world. */
function eyeOf(camera: HostCamera) {
  const elements = resolveCameraWorld(camera).matrixWorld.elements;
  return [elements[12], elements[13], elements[14]];
}

/** The reach of a cell by its largest object, for `optics` drawn `height` pixels high. */
const reachFor = (optics: PartitionOptics, height: number, pixelError: number) => (size: number) =>
  cellReach(size, optics, height, pixelError);

/**
 * Reads and places the cells `camera` needs, each through the streamer at the head of its queue;
 * resolves with the bytes read.
 */
export async function primePartitions(
  partitions: readonly PartitionCells[],
  camera: HostCamera,
  height: number,
  pixelError: number,
  streamer: Streamer,
  signal?: AbortSignal,
) {
  const reach = reachFor(camera, height, pixelError);
  const eye = eyeOf(camera);
  const read = (url: string) => streamer.readBytes(url, signal);
  const bytes = await Promise.all(partitions.map((cells) => cells.prime(eye, reach, read)));
  return bytes.reduce((sum, value) => sum + value, 0);
}

type Inputs = {
  partitions: readonly PartitionCells[];
  streamer: Streamer;
  camera: HostCamera;
  canvas: { height: number };
  /** The error target of the moment (`BackendContext.pixelError`). */
  pixelError: () => number;
  active: () => RenderBackend;
  /** Asked when rows must grow and the active engine cannot grow them in place: the owner opens
   *  the session again on the grown rows. Absent, the cell waits. */
  renew?: () => void;
};

/** The step a frame runs before it draws, or `null` when the scene is not partitioned. */
export function createPartitionFrame(inputs: Inputs) {
  const { partitions, streamer, camera, canvas, pixelError, active, renew } = inputs;
  if (!partitions.length) return null;
  const request = (urls: readonly string[], ahead: boolean) => {
    // A read that fails is said by the streamer's own diagnostics; the cell is asked again later.
    const priority = ahead ? PRIORITY_PREFETCH : PRIORITY_VISIBLE;
    streamer.request(urls, { priority }).catch(() => {});
  };
  return () => {
    const backend = active();
    const grow = backend.growPlacements
      ? backend.growPlacements.bind(backend)
      : renew && ((): void => renew());
    const io = {
      bytes: (url: string) => streamer.getBytes(url),
      loading: (url: string) => streamer.loading(url),
      request,
      update: (...range: Parameters<NonNullable<RenderBackend['updatePlacements']>>) =>
        backend.updatePlacements?.(...range),
      grow,
    };
    const reach = reachFor(camera, canvas.height, pixelError());
    const eye = eyeOf(camera);
    for (const cells of partitions) cells.frame(eye, reach, io, ARRIVAL_BUDGET_MS);
  };
}
