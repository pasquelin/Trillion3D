/**
 * The session's side of a partitioned scene (#404): the rows are sized for its camera's view and
 * the pages of the cell index on its way and the cells it reaches are read and placed before the
 * engines read the rows (`primePartitions`, #575), and before every frame the pages and the cells
 * follow the camera through the session's streamer, the decode pool and the active engine
 * (`createPartitionFrame`), the meshes whose primitive the view read since mounted in place
 * (`partitionMounts.ts`, #751).
 * The reach is the frame camera's far plane, never a number of the scene's
 * (`../../scene/partition/plan.ts`).
 */
import { unionViewReach } from './viewReach.ts';
import { EngineError, maxStretch } from '../../../../sdk-core/src/index.ts';
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { FrameBudget } from '../../page/integration/frameBudget.ts';
import { resolveCameraWorld, type HostCamera } from '../../camera/world.ts';
import type { PartitionCells } from '../../scene/partition/cells.ts';
import { cellReach } from '../../scene/partition/plan.ts';
import { lensSlope } from '../../scene/partition/superRoots.ts';
import { cellHoldings } from '../../scene/partition/cellPages.ts';
import type { createPageStreamer } from '../../streaming/pageStreamer.ts';
import { growsInPlaceOf } from '../../placement/backendSceneUpdates.ts';
import { createPartitionMounts } from './partitionMounts.ts';
import { patientTask } from '../../page/decode/host.ts';
import { cellRows, type CellRows } from '../../scene/partition/cellDecode.ts';
import type { PageBody } from '../../scene/partition/cellIndex.ts';

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

/** The cut's lens `backend` projects with while it packs the world DAG, else none (#1332). */
function lensOf(backend: RenderBackend, camera: HostCamera) {
  const cut = backend.worldCut?.();
  return cut && { ...cut, slope: lensSlope(camera) };
}

/** The file of the partition at `url` read by the decode pool, off the main thread (#575): `cells`,
 *  a cell file into its rows; `cellPage`, a page of the cell index. A refusal keeps its code — a page
 *  of another version stays `UNSUPPORTED_SCENE_TABLES` — and names the file. */
function refused(answer: Awaited<ReturnType<typeof patientTask>>, url: string): never {
  const message = answer.ok ? 'PAGE_DECODE_FAILED' : answer.message;
  const code = (!answer.ok && answer.refusal) || 'INVALID_SCENE_TABLES';
  throw new EngineError(code, message, { url });
}
async function decodeCell(bytes: Uint8Array, url: string): Promise<CellRows> {
  const answer = await patientTask('cells', bytes, url);
  return answer.ok && answer.cells ? cellRows(answer.cells) : refused(answer, url);
}
async function decodePage(bytes: Uint8Array, url: string): Promise<PageBody> {
  const answer = await patientTask('cellPage', bytes, url);
  return answer.ok && answer.cellPage ? answer.cellPage : refused(answer, url);
}

/**
 * Sizes the rows for `camera`'s view — for every node when no owner can open the session again
 * (`owned` false) —, then reads the pages of the index on its way and places the cells it reaches,
 * each through the streamer at the head of its queue and the decode pool; the bytes read.
 */
export async function primePartitions(
  partitions: readonly PartitionCells[],
  camera: HostCamera,
  streamer: Streamer,
  owned: boolean,
  signal?: AbortSignal,
) {
  const { eye, reach } = viewOf(camera);
  const io = {
    read: (url: string) => streamer.readBytes(url, signal),
    decode: decodeCell,
    decodePage,
    admit: streamer.admit,
  };
  const bytes = await Promise.all(partitions.map((cells) => cells.prime(eye, reach, io, owned)));
  return bytes.reduce((sum, value) => sum + value, 0);
}

type Inputs = {
  partitions: readonly PartitionCells[];
  streamer: Streamer;
  camera: HostCamera;
  /** Other persistent cameras sharing the one cell index and residency budget. */
  views?: () => readonly HostCamera[];
  active: () => RenderBackend;
  /** The session's one integration budget per frame (`BackendContext.frameBudget`): cells spend
   *  from it before the arrival drain and the engine's row records spend the rest. */
  budget: FrameBudget;
  /** What the session opened on (`partitionMounts.ts`). */
  opened?: Parameters<typeof createPartitionMounts>[0]['opened'];
  /** Asked once the camera's view, or a parent's stretch, outgrew the rows sized at open on an
   *  engine that grows no buffer in place, or a mesh the view read cannot be mounted in place
   *  (`partitionMounts.ts`): the owner opens the session again. Absent, a cell past those rows
   *  waits. */
  renew?: () => void;
};

/**
 * The step a frame runs before it draws, or `null` when the scene is not partitioned. Its
 * `pending` settles once the pages and cells the last frame asked for within reach are read, those
 * it handed to the decode pool decoded, and the manifest pages and mounts they asked (#751), true
 * while one of them waits for a frame to place or mount it, or a decode or a mount landed: a still
 * camera is drawn again until they all are.
 */
export function createPartitionFrame(inputs: Inputs) {
  const { partitions, streamer, camera, active, renew, budget } = inputs;
  if (!partitions.length) return null;
  const mounts = createPartitionMounts({ partitions, opened: inputs.opened, active, renew });
  const manifests = partitions.map((cells) => cellHoldings(cells).manifest);
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
      turned = [
        ...mounts.asked(),
        ...manifests.flatMap((manifest) => manifest.reads()),
        ...partitions.flatMap((cells) => cells.decodes()),
      ];
    reads = [];
    await Promise.all([...asked, ...turned]);
    return later || turned.length > 0 || mounts.stale();
  };
  const step = () => {
    mounts.sync();
    const backend = active();
    const others = inputs.views?.() ?? [];
    const io: Parameters<PartitionCells['frame']>[2] = {
      bytes: (url: string) => streamer.getBytes(url),
      decode: decodeCell,
      decodePage,
      loading: (url: string) => streamer.loading(url),
      request,
      admit: streamer.admit,
      forget: streamer.forget,
      update: (...range: Parameters<NonNullable<RenderBackend['updatePlacements']>>) =>
        backend.updatePlacements?.(...range),
      grow: backend.growPlacements && {
        growPlacements: backend.growPlacements.bind(backend),
        growsInPlace: (from, capacity) => growsInPlaceOf(backend, from, capacity),
      },
      outgrown: renew,
      // While the cut packs the world DAG, a cell its super-roots draw is held far (#1332).
      lens: others.length ? undefined : lensOf(backend, camera),
    };
    const { eye, reach } = others.length
      ? unionViewReach([viewOf(camera), ...others.map(viewOf)])
      : viewOf(camera);
    later = false;
    for (const cells of partitions) later = cells.frame(eye, reach, io, budget) || later;
  };
  return Object.assign(step, { pending });
}
