import type { Bloom } from '../../../../sdk-core/src/world/effect/bloom.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { BLOOM_PASS } from '../../diagnostic/stage/passLabels.ts'
import { fullscreenDraw } from '../filters/fullscreenDraw.ts'
import { createBloomPrograms } from './bloom/bloomPrograms.ts'
import { createBloomSet, type BloomSet } from './bloom/bloomSet.ts'
import { createBloomTargets } from './bloom/bloomTargets.ts'
import { type FusedBlend, type WebgpuEffectKind } from './webgpuKinds.ts'

/**
 * The WebGPU bloom: the images every bloom of the chain draws on (`bloom/bloomTargets.ts`), one
 * after the other, and a set of passes for each bloom (`bloom/bloomSet.ts`), made as the chain
 * asks (`resize`) and kept while it holds. `encode` draws the nth bloom's glow over the image it is
 * handed — the scene's chain shared with the local exposure (`PostFrame`): every bloom of a chain
 * glows from the image the chain was handed, and adds its own — and, with an `output`, adds it to
 * the image there (`composite`); with none it leaves the glow to the composition, which adds it
 * where it applies the exposure (`blend`). Bind groups follow the images and the two history views
 * the input alternates between: none is made per frame.
 */
export async function createWebgpuBloom(device: GPUDevice): Promise<WebgpuEffectKind<Bloom>> {
  const programs = await createBloomPrograms(device)
  const targets = createBloomTargets(device)
  const sets: BloomSet[] = [],
    blends: FusedBlend[] = []
  const draw = fullscreenDraw(BLOOM_PASS)
  // The composite's groups over the image it adds to and the glow: the two images the input
  // alternates between each keep theirs.
  const inputs = createWebgpuBindIdentity(4),
    groups: GPUBindGroup[] = []
  let blend: FusedBlend | undefined,
    setups = false
  const release = () => {
    for (const set of sets) set.dispose()
    sets.length = blends.length = 0
    blend = undefined
    targets.dispose()
  }
  return {
    /** Bytes of the blooms' images; zero before the first frame that draws one. */
    get bytes() {
      return targets.bytes
    },
    /** Holds a set of passes for each of `count` blooms; none frees them and the images. A set
     *  sizes itself at its first frame, from the scene's chain. */
    resize(_width: number, _height: number, count: number) {
      if (!count) return release()
      while (sets.length < count) sets.push(createBloomSet(device, programs, targets))
      while (sets.length > count) sets.pop()!.dispose()
    },
    /** The glow the last `encode` left to the composition. */
    get blend() {
      return blend
    },
    /** Draws the nth bloom's glow over `input`, into `output` when there is one, and returns the
     *  render passes drawn: none where every level is left out. */
    encode(encoder, bloom, nth, input, output, post) {
      blend = undefined
      if (!nth) setups = false
      const set = sets[nth],
        drawn = set.encode(encoder, bloom, post)
      setups ||= set.usedSetup
      // The setup's image and its chain, which no bloom of the chain drew this frame, go back.
      if (nth === sets.length - 1 && !setups) targets.freeSetup()
      if (!drawn) return 0
      const glow = set.view!
      if (!output) {
        // Kept for the bloom and its frames: the composition takes the same object each frame.
        blend = blends[nth] ??= { glow }
        blend.glow = glow
        return drawn
      }
      inputs.next[0] = input
      inputs.next[1] = glow
      if (inputs.moved())
        groups[inputs.slot] = device.createBindGroup({
          layout: programs.compositeLayout,
          entries: sequentialEntries([input, glow, programs.filters.clamped]),
        })
      draw(encoder, output, programs.composite, groups[inputs.slot])
      return drawn + 1
    },
    dispose: release,
  }
}
