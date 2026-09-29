/**
 * The session's side of a partitioned scene (#404): before every frame the pages of the cell index
 * and the cells follow the camera through the session's streamer, the decode pool and the active
 * engine (`createPartitionFrame`), the meshes whose primitive the view read since mounted in place
 * (`partitionMounts.ts`, #751). Nothing of the partition but its root is read before the first
 * frame (#575).
 * The reach is the frame camera's far plane, never a number of the scene's
 * (`../../scene/partition/plan.ts`).
 */
import { EngineError, maxStretch } from '../../../../sdk-core/src/index.ts';
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { FrameBudget } from '../../page/integration/frameBudget.ts';
import { resolveCameraWorld, type HostCamera } from '../../camera/world.ts';
import type { PartitionCells } from '../../scene/partition/cells.ts';
import { cellReach } from '../../scene/partition/plan.ts';
import { cellHoldings } from '../../scene/partition/cellPages.ts';
import type { createPageStreamer } from '../../streaming/pageStreamer.ts';
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

/** A file of the partition read by the decode pool, off the main thread (#575): `cells`, a cell
 *  file into its rows; `cellPage`, a page of the cell index. One of another version is refused. */
async function offThread(op: 'cells' | 'cellPage', bytes: Uint8Array) {
  const answer = await patientTask(op, bytes);
  if (answer.ok && answer.cells) return cellRows(answer.cells, bytes.byteLength);
  if (answer.ok && answer.cellPage) return answer.cellPage;
  const message = answer.ok ? 'PAGE_DECODE_FAILED' : answer.message;
  throw new EngineError('INVALID_SCENE_TABLES', message, {});
}
const decodeCell = (bytes: Uint8Array) => offThread('cells', bytes) as Promise<CellRows>;
const decodePage = (bytes: Uint8Array) => offThread('cellPage', bytes) as Promise<PageBody>;

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
  /** Asked once a mesh the view read cannot be mounted in place: the owner opens the session
   *  again (`partitionMounts.ts`). */
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
    };
    const { eye, reach } = viewOf(camera);
    later = false;
    for (const cells of partitions) later = cells.frame(eye, reach, io, budget) || later;
  };
  return Object.assign(step, { pending });
}
