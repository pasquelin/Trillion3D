/**
 * The session's side of a partitioned scene (#404): the rows are sized for its camera's view and
 * the pages of the cell index on its way and the cells it reaches are read and placed before the
 * engines read the rows (`primePartitions`, #575), and before every frame the pages and the cells
 * follow the camera through the session's streamer, the page worker pool and the engine
 * (`createPartitionFrame`), by the grids' loading ranges around its eye (`../../geometry/partition/plan.ts`).
 */
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { Engine } from '../../session/engine/types.ts'
import type { FrameBudget } from '../../geometry/integration/frameBudget.ts'
import { resolveCameraWorld, type HostCamera } from '../../camera/world.ts'
import { writeNormalizedVector3 } from '../../../../math/src/vector/vector.ts'
import type { PartitionCells } from '../../geometry/partition/cells.ts'
import type { PageStreaming } from '../../geometry/streaming/pageStreamer.ts'
import { patientTask } from '../../geometry/work/host.ts'
import { cellRows, type CellRows } from '../../geometry/partition/cellDecode.ts'
import { createViewAsks } from './viewAsks.ts'
import type { PageBody } from '../../geometry/partition/cellIndex.ts'

/** The streaming source a camera is, written into `view`: where its eye stands in the world — the
 *  source's location the grids' ranges are read from — and where it looks, unit, its `-z`: the
 *  source's axis the cells are sorted by, weighed by their distance and their angle to it. */
function viewOf(
  camera: HostCamera,
  view = { eye: new Float64Array(3), axis: new Float64Array(3) },
) {
  const elements = resolveCameraWorld(camera).matrixWorld.elements
  view.eye[0] = elements[12]
  view.eye[1] = elements[13]
  view.eye[2] = elements[14]
  writeNormalizedVector3(view.axis, 0, -elements[8], -elements[9], -elements[10])
  return view
}

/** The file of the partition at `url` read by the page worker pool, off the main thread (#575): `cells`,
 *  a cell file into its rows; `cellPage`, a page of the cell index. A refusal keeps its code — a page
 *  of another version stays `UNSUPPORTED_SCENE_TABLES` — and names the file. */
function refused(answer: Awaited<ReturnType<typeof patientTask>>, url: string): never {
  const message = answer.ok ? 'PAGE_TASK_FAILED' : answer.message
  const code = (!answer.ok && answer.refusal) || 'INVALID_SCENE_TABLES'
  throw new EngineError(code, message, { url })
}
async function decodeCell(bytes: Uint8Array, url: string): Promise<CellRows> {
  const answer = await patientTask('cells', bytes, url)
  return answer.ok && answer.cells ? cellRows(answer.cells) : refused(answer, url)
}
async function decodePage(bytes: Uint8Array, url: string): Promise<PageBody> {
  const answer = await patientTask('cellPage', bytes, url)
  return answer.ok && answer.cellPage ? answer.cellPage : refused(answer, url)
}

/**
 * Sizes the rows for `camera`'s view — for every node when no owner can open the session again
 * (`owned` false) —, then runs each partition's frame to completion (`PartitionCells.prime`), its
 * reads through the streamer at the head of its queue, its decodes on the page worker pool; the
 * bytes read.
 */
export async function primePartitions(
  partitions: readonly PartitionCells[],
  camera: HostCamera,
  streamer: PageStreaming,
  owned: boolean,
  signal?: AbortSignal,
) {
  const { eye } = viewOf(camera)
  const io = {
    read: (url: string) => streamer.readBytes(url, signal ?? streamer.signal),
    decode: decodeCell,
    decodePage,
    admit: streamer.admit,
    forget: streamer.forget,
  }
  const bytes = await Promise.all(partitions.map((cells) => cells.prime(eye, io, owned)))
  return bytes.reduce((sum, value) => sum + value, 0)
}

type Inputs = {
  partitions: readonly PartitionCells[]
  streamer: PageStreaming
  camera: HostCamera
  engine: Engine
  /** The session's one integration budget per frame (`EngineContext.frameBudget`): cells spend
   *  from it before the arrival drain and the engine's row records spend the rest. */
  budget: FrameBudget
  /** Asked once the camera's view, or a parent's stretch, outgrew the rows sized at open on an
   *  engine that grows no buffer in place: the owner opens the session again. Absent, a cell
   *  past those rows waits. */
  renew?: () => void
}

/**
 * The step a frame runs before it draws, over the partitions the session follows: those it was
 * opened with, and those that join it (`follow`) or leave it (`leave`) while it runs. Its
 * `pending` settles once the pages and cells the last frame asked for within reach are read, those
 * it handed to the page worker pool decoded, and the next of the cells' holds on its way landed,
 * true while one of them waits for a frame to place it, or a decode or a hold landed: a still
 * camera is drawn again until they all are. A read that failed and may pass stays on its way till
 * it lands (`../../geometry/streaming/failures.ts`): nothing else wakes the loop for it.
 */
export function createPartitionFrame(inputs: Inputs) {
  const { streamer, camera, engine: backend, renew, budget } = inputs
  const partitions = [...inputs.partitions]
  const asks = createViewAsks(streamer)
  let reads: Promise<void>[] = [],
    later = false
  const request = (urls: readonly string[]) => {
    // A read that fails is said by the streamer's own diagnostics; the frames ask it while they
    // need it (`viewAsks.ts`), and wait on it.
    for (const read of asks.ask(urls)) reads.push(read)
  }
  const pending = async () => {
    const asked = reads,
      turned = [
        ...partitions.flatMap((cells) => cells.reads()),
        ...partitions.flatMap((cells) => cells.decodes()),
      ]
    reads = []
    await Promise.all([...asked, ...turned])
    return later || turned.length > 0
  }
  const update = (...range: Parameters<Engine['updatePlacements']>) =>
    backend.updatePlacements(...range)
  const bytes = (url: string) => streamer.getBytes(url),
    failed = (url: string) => streamer.failed(url)
  const compose: Parameters<PartitionCells['frame']>[1]['compose'] = (
    parent,
    world,
    links,
    whole,
  ) => backend.composePlacements(parent, world, links, whole)
  /** Each partition's io, made once: its world cells read anew each frame, a cut made again lending
   *  its own. */
  const ios = new WeakMap<PartitionCells, Parameters<PartitionCells['frame']>[1]>()
  const io = (cells: PartitionCells) => {
    let own = ios.get(cells)
    if (!own) {
      own = {
        bytes,
        decode: decodeCell,
        decodePage,
        failed,
        request,
        admit: streamer.admit,
        forget: streamer.forget,
        update,
        grow: backend,
        compose,
        outgrown: renew,
        // While the cut packs this partition's world DAG, it draws each HLOD cell as the cells
        // tell it.
        get world() {
          return backend.worldCells(cells.world)
        },
      }
      ios.set(cells, own)
    }
    return own
  }
  const seen = viewOf(camera)
  const step = () => {
    if (!partitions.length) return
    const { eye, axis } = viewOf(camera, seen)
    later = false
    for (const cells of partitions) later = cells.frame(eye, io(cells), budget, axis) || later
    asks.end()
  }
  return Object.assign(step, {
    pending,
    /** `cells` are followed from the next frame, placed for the view by `primePartitions` first. */
    follow(cells: readonly PartitionCells[]) {
      for (const one of cells) if (!partitions.includes(one)) partitions.push(one)
    },
    /** `cells` are followed no more: each gives its rows and its holds back. */
    leave(cells: readonly PartitionCells[]) {
      for (const one of cells) {
        const at = partitions.indexOf(one)
        if (at < 0) continue
        partitions.splice(at, 1)
        one.close({ update })
      }
      asks.end()
    },
  })
}
