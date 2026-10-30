import type { GraphRasters } from '../../../materials/graph/graphRasters.ts'
import type { HeldMake } from './sceneMaskHold.ts'
import { oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import type { PixelProgram } from '../../../materials/graph/pixelProgram.ts'

/** The graph programs whose `opacityMask` the any-hit test evaluates (`sceneMaskWgsl.ts`): the cutting programs of the session's rasters, sorted by key. */
export type SceneMaskPrograms = readonly PixelProgram[]

/** No graph mask: the any-hit test keeps the triangles of a surface whose graph computes its mask whole. */
export const NO_SCENE_MASKS: SceneMaskPrograms = []

/** What tells two sets apart in the name of a text made over one: the keys of the programs, none for none. */
export const sceneMaskKey = (programs: SceneMaskPrograms) =>
  programs.map((program) => program.key).join('.')

/** The set of each array of programs the rasters held, by the array: `GraphRasters` makes another array when a graph joins (`graphRasters.ts`), so the array's identity tells the filtering is still good. */
const ofPrograms = new WeakMap<readonly PixelProgram[], SceneMaskPrograms>()

/** The set of each content, by the keys of its programs: a set that returns to a content a held or wanted set still has gives that very set (so the kernels keyed by the set's identity are not made again, whichever runtime asks), and a set nothing names is collected. */
const interned = new Map<string, WeakRef<SceneMaskPrograms>>()
const forgotten = new FinalizationRegistry<string>((key) => {
  if (!interned.get(key)?.deref()) interned.delete(key)
})

const remember = (programs: readonly PixelProgram[], set: SceneMaskPrograms) => {
  ofPrograms.set(programs, set)
  return set
}

/**
 * THE PROGRAMS THE RAYS CUT BY: the programs of `rasters` that wire an `opacityMask`, the very ones the rasters evaluate (`GraphRasters.pixelPrograms`, which `frame/prepare/lateGraphs.ts`
 * grows when a graph joins), in the rasters' order (sorted by key, so that the set's key and the text made over it do not depend on the order the programs joined in). The same array for the same
 * programs, so that it names the kernels made over it, even when the rasters made a new array of programs that cuts by the same ones or the set came back to a content it had before; asked every frame, it is made once for each array of the rasters.
 */
export function sceneMaskProgramsOf(rasters: GraphRasters): SceneMaskPrograms {
  const known = ofPrograms.get(rasters.pixelPrograms)
  if (known) return known
  const cutting = rasters.pixelPrograms.filter((program) => program.cuts)
  if (cutting.length === 0) return remember(rasters.pixelPrograms, NO_SCENE_MASKS)
  const key = sceneMaskKey(cutting)
  const same = interned.get(key)?.deref()
  if (same) return remember(rasters.pixelPrograms, same)
  interned.set(key, new WeakRef(cutting))
  forgotten.register(cutting, key)
  return remember(rasters.pixelPrograms, cutting)
}

/**
 * `make`, run once a device, a key and a set of programs and kept for every later caller of the three (the kernels a pass makes over the set of graph masks `maskHold.use` returns): the value is held by the set's
 * identity, so that it goes with a superseded set nothing else names. A set left out is the one without graph masks. `forget` drops what is kept for a device and a key.
 */
export function oncePerDeviceOverPrograms<K extends string, T extends object>(
  make: (device: GPUDevice, key: K, programs: SceneMaskPrograms) => T,
) {
  const byDevice = new WeakMap<GPUDevice, Map<string, WeakMap<SceneMaskPrograms, T>>>()
  return Object.assign(
    (device: GPUDevice, key: K, programs: SceneMaskPrograms = NO_SCENE_MASKS): T => {
      let byKey = byDevice.get(device)
      if (!byKey) byDevice.set(device, (byKey = new Map()))
      return madeForPrograms(byKey, key, programs, () => make(device, key, programs))
    },
    { forget: (device: GPUDevice, key: K) => void byDevice.get(device)?.delete(key) },
  )
}

/**
 * The thing `make` made for `programs` under `key` in `byKey`, made on the first ask: held by the set's identity, so that a superseded set takes its kernel with it when nothing else names it
 * (a text key would keep every set's kernel for as long as the map lives).
 */
export function madeForPrograms<K extends object>(
  byKey: Map<string, WeakMap<SceneMaskPrograms, K>>,
  key: string,
  programs: SceneMaskPrograms,
  make: () => K,
): K {
  let bySet = byKey.get(key)
  if (!bySet) byKey.set(key, (bySet = new WeakMap()))
  let made = bySet.get(programs)
  if (!made) bySet.set(programs, (made = make()))
  return made
}

/**
 * The maker the mask hold takes (`maskHold.use`) for a device and a key, over `kernelOf` (a kernel made for a device, a key and a set of programs): one function each of the two, not one an image,
 * so that the hold finds the same function at every image. For keys that come and go (`onRelease` given), the maker carries `acquire` and `release`, which each hold calls when its first pass naming the maker
 * comes and its last is forgotten: the holds of a device are counted, and when none is left it frees what `kernelOf` (its `forget`) and `onRelease` kept for the device and the key.
 */
export function heldMakerOf<K, T>(
  kernelOf: ((device: GPUDevice, key: K, programs: SceneMaskPrograms) => T) & {
    forget?: (device: GPUDevice, key: K) => void
  },
  onRelease?: (device: GPUDevice, key: K) => void,
) {
  const makers = oncePerDeviceKey((device: GPUDevice, key: K): HeldMake<T> => {
    const make: HeldMake<T> = (programs) => kernelOf(device, key, programs)
    if (onRelease) {
      let holds = 0
      make.acquire = () => void holds++
      make.release = () => {
        if (--holds > 0) return
        kernelOf.forget?.(device, key)
        onRelease(device, key)
        makers.forget(device, key)
      }
    }
    return make
  })
  return makers
}
