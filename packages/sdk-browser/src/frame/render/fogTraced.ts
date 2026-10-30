import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { shadowsFogOf } from '../../../../sdk-core/src/scene/light/fields.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { FOG_TRACED_WORD_BITS } from '../../lighting/fog/layout.ts'
import {
  FOG_TRACED_HOLD,
  fogTracedMaker,
  type FogTracedKernel,
} from '../../lighting/fog/tracedPass.ts'
import { isPending, isReady } from '../../lighting/rays/sceneTrace/sceneMaskHold.ts'
import { rayTracedSamples } from '../../lighting/shadows/rayTraced/rayTracedLights.ts'
import {
  sceneRaysOf,
  type SceneRays,
} from '../../lighting/surfaceCache/lighting/surfaceLighting.ts'
import { viewKey } from '../backend/state/viewKey.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The words `writeFogTracedLights` fills for each view, kept from image to image and grown with the light buffer (a light's rank is below the lights' count). */
const heldByView = new WeakMap<object, { words: Uint32Array<ArrayBuffer>; owners: string[] }>()

/**
 * The lights whose shadow the fog's volume holds by a ray traced from each cell (`volumetricFogInjectRaytracedLights`), as a bit a rank of the light buffer, 32 ranks a word: every light that casts its
 * shadow by rays (`rayTracedSamples`) and shadows the fog (`shadowsFog`), the sun only if it is the fog's directional light. None, written into `into` (the volume's inputs,
 * nothing allocated but the words' growth): `tracedLights` the words, `tracedOwners` the ids of the lights they name (a rank can change hands), `tracedWords` how many hold a bit, while the setting is off or the pass that traces them is still compiling (asked from the first image the
 * setting is on). `rays` is the scene trace the lighting made for this image and `tracedKernel` the pass that traces over it (asked of the hold once for the image, and ready), none where it made none: the volume is then not traced again.
 */
export function writeFogTracedLights(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  settings: VolumetricFogValues,
  into: {
    tracedLights: Uint32Array | undefined
    tracedOwners: string[] | undefined
    tracedWords: number | undefined
    rays?: SceneRays | undefined
    tracedKernel?: FogTracedKernel | undefined
  },
) {
  into.tracedWords = 0
  into.rays = undefined
  into.tracedKernel = undefined
  const shadows = rt.lights.vsm?.state.maps.shadows
  if (!settings.volumetricFogInjectRaytracedLights || !shadows) return
  // The pass is asked of the programs the scene trace holds, as the pass that runs it is, and only in an image the lighting settled them for (it made the scene trace's rays): nothing is compiled
  // outside the hold, and none before a scene trace exists. An image with no rays names the lights all the same (below).
  const trace = rt.surfaceCache?.lighting?.sceneTrace
  if (!trace) return
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  const kernel =
    rays &&
    trace.maskHold.use(FOG_TRACED_HOLD, '', fogTracedMaker(device, 'traced'), isReady, isPending)
      ?.kernel
  if (rays && !kernel?.ready) return
  const { store } = rt.lights
  const words = ceilDiv(store.ids.length, FOG_TRACED_WORD_BITS)
  const key = viewKey(rt.gpu)
  let held = heldByView.get(key)
  if (!held || held.words.length < words) {
    held = { words: new Uint32Array(Math.max(words, (held?.words.length ?? 4) * 2)), owners: [] }
    heldByView.set(key, held)
  }
  held.words.fill(0, 0, words)
  held.owners.length = 0
  let used = 0
  for (const id of store.ids) {
    const light = store.light(id)
    const rank = store.slotOf(id)
    if (!light || rank < 0 || !shadowsFogOf(light)) continue
    if (light.kind === 'directional' && rank !== store.forwardDirectionalSlot) continue
    if (rayTracedSamples(shadows, light) <= 0) continue
    const word = Math.floor(rank / FOG_TRACED_WORD_BITS)
    held.words[word]! |= 1 << (rank % FOG_TRACED_WORD_BITS)
    held.owners.push(id)
    used = Math.max(used, word + 1)
  }
  if (used === 0) return
  into.tracedLights = held.words
  into.tracedOwners = held.owners
  into.tracedWords = used
  // An image with no scene trace names the lights all the same, where the volume was traced for these lights in its allocation (`buildVolume`): it keeps the shadows the last trace left, read as they are, rather than hand the lights back to their maps for one image.
  into.rays = rays
  into.tracedKernel = kernel
}
