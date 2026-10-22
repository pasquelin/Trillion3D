import type { Bloom } from '../../../../sdk-core/src/world/effect/bloom.ts'
import { BLOOM_RULES } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { BLOOM_PASS } from '../../diagnostic/stage/passLabels.ts'
import { fullscreenDraw } from '../filters/fullscreenDraw.ts'
import type { PostFrame } from '../finish/finish.ts'
import { createBloomPrograms } from './bloom/bloomPrograms.ts'
import { createBloomSet, type BloomSet } from './bloom/bloomSet.ts'
import { createBloomTargets, type BloomTargets } from './bloom/bloomTargets.ts'
import { dirtShows, type GlowFinishing } from './bloom/glowFinish.ts'
import { type FusedBlend, type WebgpuEffectKind } from './webgpuKinds.ts'

/** How the bloom is drawn where the frame names none: the settings' defaults. */
const DEFAULT_SETTINGS = resolveSettings(BLOOM_RULES, {})

type BloomPrograms = Awaited<ReturnType<typeof createBloomPrograms>>

/** The composite of a glow into the image the next pass reads: its groups over the image and the
 *  glow, the two images the input alternates between each keeping theirs. */
function createComposite(device: GPUDevice, programs: BloomPrograms) {
  const draw = fullscreenDraw(BLOOM_PASS)
  const inputs = createWebgpuBindIdentity(4),
    groups: GPUBindGroup[] = []
  return (
    encoder: GPUCommandEncoder,
    input: GPUTextureView,
    glow: GPUTextureView,
    output: GPUTextureView,
  ) => {
    inputs.next[0] = input
    inputs.next[1] = glow
    if (inputs.moved())
      groups[inputs.slot] = device.createBindGroup({
        layout: programs.compositeLayout,
        entries: sequentialEntries([input, glow, programs.filters.clamped]),
      })
    draw(encoder, output, programs.composite, groups[inputs.slot])
  }
}

/**
 * WHAT THE CHAIN'S BLOOMS DREW THIS IMAGE: whether any drew a setup, a convolution, a finished glow.
 * What none drew goes back after the last bloom — the setup's image and its chain, the convolution's
 * images, the finished glow.
 */
function createUsage(targets: BloomTargets) {
  let setups = false,
    convolutions = false,
    finishes = false
  return {
    begin() {
      setups = convolutions = finishes = false
    },
    note(set: BloomSet, finished: boolean) {
      setups ||= set.usedSetup
      convolutions ||= set.usedConvolution
      finishes ||= finished
    },
    release() {
      if (!setups) targets.freeSetup()
      if (!convolutions) targets.freeConvolution()
      if (!finishes) targets.freeFinish()
    },
  }
}

/**
 * THE FINISHING OF A BLOOM'S GLOW where its tint dims the image or its dirt mask shows
 * (`bloom/glowFinish.ts`): the glow finished, none where the glow needs no finishing. What it is
 * finished with is rewritten by each bloom: an image allocates none.
 */
function createGlowFinishing(targets: BloomTargets) {
  const finishing: GlowFinishing = {
    dirt: undefined as never,
    intensity: 0,
    keep: undefined,
    fused: false,
  }
  const keep = [0, 0, 0]
  return (
    encoder: GPUCommandEncoder,
    set: BloomSet,
    bloom: Bloom,
    input: GPUTextureView,
    fused: boolean,
    post: PostFrame,
  ) => {
    const tint = set.tint
    const dims = tint !== undefined && (tint[0] < 1 || tint[1] < 1 || tint[2] < 1)
    if (!dims && !dirtShows(bloom.dirtMask, bloom.intensity)) return undefined
    for (let c = 0; c < 3; c++) keep[c] = dims ? tint![c] - 1 : 0
    finishing.dirt = bloom.dirtMask
    finishing.intensity = bloom.intensity
    finishing.fused = fused
    finishing.keep = dims ? keep : undefined
    const size = post.scene.imageSize
    return targets.glowFinish().encode(encoder, input, set.view!, size, finishing, post)
  }
}

/**
 * The WebGPU bloom: the images every bloom of the chain draws on (`bloom/bloomTargets.ts`), one
 * after the other, and a set of passes for each bloom (`bloom/bloomSet.ts`), made as the chain
 * asks (`resize`) and kept while it holds. `encode` draws the nth bloom's glow over the image it is
 * handed — the scene's chain shared with the local exposure (`PostFrame`): every bloom of a chain
 * glows from the image the chain was handed, and adds its own — finishes it where the dirt mask or
 * a convolution asks (`bloom/glowFinish.ts`), and, with an `output`, adds it to the image there
 * (`composite`); with none it leaves the glow to the composition, which adds it where it applies the
 * exposure (`blend`). Bind groups follow the images and the two history views the input alternates
 * between: none is made per frame.
 */
export async function createWebgpuBloom(device: GPUDevice): Promise<WebgpuEffectKind<Bloom>> {
  const programs = await createBloomPrograms(device)
  const targets = createBloomTargets(device)
  const sets: BloomSet[] = [],
    blends: FusedBlend[] = []
  const composite = createComposite(device, programs)
  const usage = createUsage(targets)
  const finish = createGlowFinishing(targets)
  let blend: FusedBlend | undefined
  const release = () => {
    for (const set of sets) set.dispose()
    sets.length = blends.length = 0
    blend = undefined
    targets.dispose()
  }
  return {
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
    encode(encoder, bloom, nth, input, output, post, settings = DEFAULT_SETTINGS) {
      blend = undefined
      if (!nth) usage.begin()
      const set = sets[nth]
      let drawn = set.encode(encoder, bloom, post, settings, input)
      const finished = drawn > 0 ? finish(encoder, set, bloom, input, !output, post) : undefined
      usage.note(set, finished !== undefined)
      if (nth === sets.length - 1) usage.release()
      if (!drawn) return 0
      const glow = finished ?? set.view!
      if (finished) drawn++
      if (!output) {
        // Kept for the bloom and its frames: the composition takes the same object each frame.
        blend = blends[nth] ??= { glow }
        blend.glow = glow
        return drawn
      }
      composite(encoder, input, glow, output)
      return drawn + 1
    },
    dispose: release,
  }
}
