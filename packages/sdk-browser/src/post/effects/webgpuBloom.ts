import type { Bloom } from '../../../../sdk-core/src/world/effect/bloom.ts'
import type { ResolvedBloomDirtMask } from '../../../../sdk-core/src/contracts/bloomDirtOptions.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { uniformBlock } from '../../gpu/core/uniformBlock.ts'
import { BLOOM_PASS } from '../../diagnostic/stage/passLabels.ts'
import { fullscreenDraw } from '../filters/fullscreenDraw.ts'
import { createBloomPrograms } from './bloom/bloomPrograms.ts'
import { convolutionArriving } from './bloom/convolution/convolutionPrograms.ts'
import { createBloomSet, type BloomSet } from './bloom/bloomSet.ts'
import { createBloomTargets, type BloomTargets } from './bloom/bloomTargets.ts'
import { BLOOM_LOOK, BLOOM_LOOK_BYTES } from './bloom/bloomWgsl.ts'
import { dirtLevel } from './bloom/dirtMask.ts'
import type { ValuesOf } from './kindRules.ts'
import { type FusedBlend, type WebgpuEffectKind } from './webgpuKinds.ts'

type BloomPrograms = Awaited<ReturnType<typeof createBloomPrograms>>

/** Whether the dirt mask is drawn: a picture, an intensity, and a glow that has one. */
const dirtShows = (dirt: ResolvedBloomDirtMask, intensity: number) =>
  dirt.image !== undefined && dirt.intensity > 0 && intensity > 0

/** Writes a `vec4f` of the composite's uniform: the three numbers `rgb` and a 1 where `on`, else 0s. */
function putLook(words: Float32Array, at: number, on: boolean, rgb: readonly number[]) {
  putVec4(words, at, on ? rgb[0] : 0, on ? rgb[1] : 0, on ? rgb[2] : 0, on ? 1 : 0)
}

/** The composite of a glow into the image the next pass reads: the glow times the dirt the mask
 *  shows and the image times what the glow left it, as `blend` says, summed. Its groups over the
 *  image, the glow and the mask, the images the input alternates between each keeping theirs. */
function createComposite(device: GPUDevice, programs: BloomPrograms) {
  const draw = fullscreenDraw(BLOOM_PASS)
  const look = uniformBlock(device, BLOOM_PASS, BLOOM_LOOK_BYTES)
  const inputs = createWebgpuBindIdentity(4),
    groups: GPUBindGroup[] = []
  return (
    encoder: GPUCommandEncoder,
    input: GPUTextureView,
    blend: FusedBlend,
    output: GPUTextureView,
  ) => {
    const mask = blend.mask ?? programs.filters.empty
    inputs.next[0] = input
    inputs.next[1] = blend.glow
    inputs.next[2] = mask
    if (inputs.moved())
      groups[inputs.slot] = device.createBindGroup({
        layout: programs.compositeLayout,
        entries: sequentialEntries([
          input,
          blend.glow,
          programs.filters.clamped,
          mask,
          { buffer: look.buffer, size: BLOOM_LOOK_BYTES },
        ]),
      })
    putLook(look.words.f, BLOOM_LOOK.at.keep, blend.keeps, blend.keep)
    putLook(look.words.f, BLOOM_LOOK.at.dirt, blend.mask !== undefined, blend.factor)
    look.send()
    draw(encoder, output, programs.composite, groups[inputs.slot])
  }
}

/**
 * WHAT THE CHAIN'S BLOOMS DREW THIS IMAGE: whether any drew a setup, a convolution, a dirt mask.
 * What none drew goes back after the last bloom — the setup's image and its chain, the convolution's
 * images, the dirt mask.
 */
function createUsage(targets: BloomTargets) {
  let setups = false,
    convolutions = false,
    masks = false
  return {
    /** Notes what the `nth` of `count` blooms drew; after the last, gives back what none did. */
    note(set: BloomSet, masked: boolean, nth: number, count: number) {
      if (!nth) setups = convolutions = masks = false
      setups ||= set.usedSetup
      convolutions ||= set.usedConvolution
      masks ||= masked
      if (nth < count - 1) return
      if (!setups) targets.freeSetup()
      if (!convolutions) targets.freeConvolution()
      if (!masks) targets.freeDirt()
    },
  }
}

/** A blend with nothing drawn yet: the glow is the caller's. */
const newBlend = (glow: GPUTextureView): FusedBlend => ({
  glow,
  keeps: false,
  keep: [1, 1, 1],
  mask: undefined,
  factor: [0, 0, 0],
})

/**
 * WHAT A BLOOM'S GLOW IS ADDED WITH, written into `blend`: the share of the image's light the glow
 * took where the convolution's tint dims it (`set.tint`: the image's colour is then multiplied by
 * it), and, where the dirt mask shows, the mask — read at the level the image's size asks —, its
 * tint times its intensity over the bloom's the factor the glow is multiplied by. The mask is
 * drawn once, on the first image that shows it.
 */
function writeBlend(
  blend: FusedBlend,
  targets: BloomTargets,
  encoder: GPUCommandEncoder,
  set: BloomSet,
  bloom: Bloom,
  size: readonly number[],
) {
  const tint = set.tint
  blend.keeps = tint !== undefined && (tint[0] < 1 || tint[1] < 1 || tint[2] < 1)
  if (blend.keeps) for (let c = 0; c < 3; c++) blend.keep[c] = tint![c]
  const { dirtMask } = bloom
  const shows = dirtShows(dirtMask, bloom.intensity)
  const { image } = dirtMask
  blend.mask = shows ? targets.dirtMask.view(encoder, image!, dirtLevel(image!, size)) : undefined
  if (shows) {
    const scale = dirtMask.intensity / bloom.intensity
    for (let c = 0; c < 3; c++) blend.factor[c] = dirtMask.tint[c] * scale
  }
  return shows
}

/**
 * The WebGPU bloom: the images every bloom of the chain draws on (`bloom/bloomTargets.ts`), one
 * after the other, and a set of passes for each bloom (`bloom/bloomSet.ts`), made as the chain
 * asks (`resize`) and kept while it holds. `encode` draws the nth bloom's glow over the image it is
 * handed — the scene's chain shared with the local exposure (`PostFrame`): every bloom of a chain
 * glows from the image the chain was handed, and adds its own — and, with an `output`, adds it to
 * the image there (`composite`); with none it leaves the glow to the composition, which adds it
 * where it applies the exposure (`blend`). Either way the glow comes with the dirt mask over it and
 * the share of the image's light a convolution took: no pass of its own, the pass that adds the
 * glow applies them. Bind groups follow the images and the two history views the input alternates
 * between: none is made per frame.
 */
export async function createWebgpuBloom(
  device: GPUDevice,
): Promise<WebgpuEffectKind<Bloom, ValuesOf<'bloom'>>> {
  const programs = await createBloomPrograms(device)
  const targets = createBloomTargets(device)
  const sets: BloomSet[] = [],
    blends: FusedBlend[] = []
  const composite = createComposite(device, programs)
  const usage = createUsage(targets)
  let blend: FusedBlend | undefined
  const release = () => {
    for (const set of sets) set.dispose()
    sets.length = blends.length = 0
    blend = undefined
    targets.dispose()
  }
  return {
    /** The compile of a convolution's transform the frame asked for while it drew: the image drawn
     *  meanwhile lacks the glow, and is drawn again once it landed. */
    get arriving() {
      return convolutionArriving(device)
    },
    /** Bytes of the blooms' images; zero before the first frame that draws one. */
    get bytes() {
      return sets.reduce((bytes, set) => bytes + set.bytes, targets.bytes)
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
     *  passes drawn: none where every level is left out. */
    encode(encoder, bloom, nth, input, output, post, settings) {
      blend = undefined
      const set = sets[nth]
      const drawn = set.encode(encoder, bloom, post, settings, input)
      // Kept for the bloom and its frames: the composition takes the same object each frame.
      const made = (blends[nth] ??= newBlend(input))
      const masked =
        drawn > 0 && writeBlend(made, targets, encoder, set, bloom, post.scene.imageSize)
      usage.note(set, masked, nth, sets.length)
      if (!drawn) return 0
      made.glow = set.view!
      if (!output) {
        blend = made
        return drawn
      }
      composite(encoder, input, made, output)
      return drawn + 1
    },
    dispose: release,
  }
}
