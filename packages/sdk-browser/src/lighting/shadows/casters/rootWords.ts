import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { castFlagsOf } from './castFlags.ts'
import { readShadowSetting } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { CAST_STATE_WORDS } from './castChanges.ts'
import { ROOT_SECTION, ROOT_SECTIONS } from './rootWordsWgsl.ts'
import { pagesDisplacementReach } from '../../../visibility/tessellation/numbers.ts'

/**
 * What `mobility.writeRoots` reads of the roots, built once per runtime and kept on its lights
 * (`mobilitySource`): the roots are the layout's own objects for the session
 * (`../../../frame/prepare/layout.ts`), and the buffer is read from the lights when a run is pushed,
 * so no run and no image builds a closure. `device` is the one the call in progress uploads on.
 */
export type RootWordsSource = {
  device: GPUDevice
  push: (first: number, count: number) => void
  /** Whether the primitives that wear an offset or a displacement are cached as still ones
   *  (`shadowCacheWpoPrimitives`), as the last upload read it. */
  cachesWpo: boolean
  castFlags: (rank: number) => number
  /** Whether a banked root reads its rest pose: no deformation moves its vertices. */
  rests: (rank: number) => boolean
  disableSq: (rank: number) => number
  /** The reach of the root's deformation (`ClusterRoot.deformReach`), 0 for none. */
  deformReach: (rank: number) => number
}

/** The sections the host writes (`ROOT_SECTION`, `rootWordsWgsl.ts`), and the arrays of the mobility
 *  they come from; the instances' state is the GPU's. */
const HOST_SECTIONS = [
  [ROOT_SECTION.word, 'words'],
  [ROOT_SECTION.distance, 'disable'],
  [ROOT_SECTION.reach, 'reach'],
] as const

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
    cachesWpo: false,
    push: (first, count) => {
      const { rootWords, mobility } = lights,
        placements = rootWords!.size / (ROOT_SECTIONS * 4)
      for (const [section, field] of HOST_SECTIONS)
        source.device.queue.writeBuffer(
          rootWords!,
          (section * placements + first) * 4,
          mobility[field],
          first,
          count,
        )
    },
    rests: (rank) => rt.vis.deformation?.tracks.named(rank) === -1,
    castFlags: (rank) => {
      const root = selectionRoots[rank],
        offsets = rt.vis.rootOffsets.rowOf(rank)
      // A placement arrives moving when a surface of it wears an offset or a displacement and the
      // primitives that wear one are not cached: the reference's mesh shape that is often moving.
      const wpoMoves =
        !source.cachesWpo && (!!offsets?.worn || pagesDisplacementReach(root?.pages ?? []) > 0)
      return castFlagsOf(root, offsets, source.rests(rank), wpoMoves)
    },
    disableSq: (rank) => {
      const row = rt.vis.rootOffsets.rowOf(rank)
      return row ? row.disable * row.disable : 0
    },
    deformReach: (rank) => selectionRoots[rank]?.deformReach ?? 0,
  }
  lights.mobilitySource = source
  return source
}

/** The buffer of `roots` placements' words (`ROOT_SECTIONS`, `rootWordsWgsl.ts`); a binding holds at least one. */
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
  // The option turned: the primitives that wear an offset are made anew, as the reference recreates
  // the render state of every primitive when it changes, and each arrives as a new one.
  const cachesWpo = readShadowSetting(rt, 'shadowCacheWpoPrimitives')
  if (cachesWpo !== source.cachesWpo) {
    source.cachesWpo = cachesWpo
    mobility.rearrive()
  }
  const owed = Math.max(1, mobility.words.length)
  // A buffer made anew: every word goes up, and every page may cast anew.
  const made = !lights.rootWords || lights.rootWords.size !== ROOT_SECTIONS * owed * 4
  if (made) {
    lights.rootWords?.destroy()
    lights.rootWords = rootWordsBuffer(device, owed)
    mobility.rewrite()
  }
  let wrote = made
  mobility.writeRoots((first, count) => {
    source.push(first, count)
    wrote = true
  }, source)
  return wrote
}
