import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { castFlagsOf } from './castFlags.ts'
import { CAST_STATE_WORDS } from './castChanges.ts'

/**
 * What `mobility.writeRoots` reads of the roots, built once per runtime and kept on its lights
 * (`mobilitySource`): the roots are the layout's own objects for the session
 * (`../../../frame/prepare/layout.ts`), and the buffer is read from the lights when a run is pushed,
 * so no run and no image builds a closure. `device` is the one the call in progress uploads on.
 */
export type RootWordsSource = {
  device: GPUDevice
  push: (first: number, count: number) => void
  castFlags: (rank: number) => number
  disableSq: (rank: number) => number
}

function sourceOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const built = rt.lights.mobilitySource
  if (built) {
    built.device = device
    return built
  }
  const { lights, layout } = rt,
    { selectionRoots } = layout
  const source: RootWordsSource = {
    device,
    push: (first, count) => {
      // Three sections of the buffer's placements: the words, the instances' state (the GPU's), the
      // distances.
      const { rootWords } = lights,
        placements = rootWords!.size / (ROOT_SECTIONS * 4)
      source.device.queue.writeBuffer(rootWords!, first * 4, lights.mobility.words, first, count)
      source.device.queue.writeBuffer(
        rootWords!,
        (2 * placements + first) * 4,
        lights.mobility.disable,
        first,
        count,
      )
    },
    castFlags: (rank) => castFlagsOf(selectionRoots[rank], rt.vis.rootOffsets.rowOf(rank)),
    disableSq: (rank) => {
      const row = rt.vis.rootOffsets.rowOf(rank)
      return row ? row.disable * row.disable : 0
    },
  }
  lights.mobilitySource = source
  return source
}

/** The sections of the placements' buffer, a word a placement each: the mobility words, the
 *  instances' state per view (`castDiffWgsl.ts`, `castInstanceState`) and the squares of the offsets'
 *  distances. */
const ROOT_SECTIONS = 3

/** The buffer of `roots` placements' words (`ROOT_SECTIONS`); a binding holds at least one. */
const rootWordsBuffer = (device: GPUDevice, roots: number) =>
  device.createBuffer({
    label: 'Trillion3D shadow placement words v2',
    size: ROOT_SECTIONS * Math.max(1, roots) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

/** Bytes the shadows' per-placement data takes at `roots` placements: the words, and what the diff
 *  remembers of each (`CAST_STATE_WORDS`). */
export const shadowRootBytes = (roots: number) =>
  Math.max(1, roots) * (ROOT_SECTIONS + CAST_STATE_WORDS) * 4

/** Each runtime's reader of a placement's pose by rank, made once: the roots are read live. */
const poseReaders = new WeakMap<WebgpuPagesRuntime, (rank: number) => ArrayLike<number>>()

/**
 * The words of the placements whose mobility or casting changed, on the buffer made at the roots'
 * count (`mobility.ensure`): whether it moves, whether it casts, casts far, is tested for far
 * shadows, never invalidates its shadows, deforms. Every word goes up with a buffer made anew; later
 * only the words of the placements `touch`ed since, in runs. `wrote`: a word was written, so the diff
 * of the instances' boxes has a change to name, still or not (`castDiff.ts`), which it returns.
 */
export function uploadRootWords(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, layout } = rt,
    { mobility } = lights,
    { selectionRoots } = layout
  let pose = poseReaders.get(rt)
  if (!pose) poseReaders.set(rt, (pose = (rank) => rt.layout.selectionRoots[rank].world.elements))
  mobility.ensure(selectionRoots.length, pose)
  const source = sourceOf(rt, device)
  const owed = Math.max(1, mobility.words.length)
  // A buffer made anew: every word goes up, and every page may cast anew.
  const made = !lights.rootWords || lights.rootWords.size !== ROOT_SECTIONS * owed * 4
  if (made) {
    lights.rootWords?.destroy()
    lights.rootWords = rootWordsBuffer(device, owed)
    mobility.rewrite()
  }
  let wrote = made
  mobility.writeRoots(
    (first, count) => {
      source.push(first, count)
      wrote = true
    },
    source.castFlags,
    source.disableSq,
  )
  return wrote
}
