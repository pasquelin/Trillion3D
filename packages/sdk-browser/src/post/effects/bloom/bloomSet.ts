import type { Bloom } from '../../../../../sdk-core/src/world/effect/bloom.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../../sdk-core/src/contracts/bloomOptions.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../../gpu/core/computeBindings.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { BLOOM_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { fullscreenDraw } from '../../filters/fullscreenDraw.ts'
import { createGaussianStage } from '../../filters/gaussianStage.ts'
import type { PostFrame } from '../../finish/finish.ts'
import type { createBloomPrograms } from './bloomPrograms.ts'
import { BLOOM_LEVEL_LEAST, bloomTintScale } from './bloomFilter.ts'
import type { BloomTargets } from './bloomTargets.ts'
import { BLOOM_SETUP, BLOOM_SETUP_BYTES } from './bloomWgsl.ts'

/** A bloom's passes (`createBloomSet`). */
export type BloomSet = ReturnType<typeof createBloomSet>

type BloomPrograms = Awaited<ReturnType<typeof createBloomPrograms>>
type BloomFilters = BloomPrograms['filters']

/** What the setup's uniform was written for before the first time: no size, no value equal to it. */
const UNSET = { width: 0, height: 0, threshold: NaN, layers: NaN }

/** The images of the scene's chain, or of the chain under the setup's: the size and the view of
 *  each level. */
type Levels = {
  size(level: number): readonly number[]
  view(level: number): GPUTextureView | undefined
}

/**
 * THE BLOOM'S SETUP UNIFORM AND GROUP: the group reading the half-size image through the filters'
 * layout, and the uniform written when the size, the threshold or the layers move. Made at the
 * first ask, kept while they hold.
 */
function createSetupGroup(device: GPUDevice, filters: BloomFilters) {
  const words = new Float32Array(BLOOM_SETUP.words)
  const identity = createWebgpuBindIdentity()
  let uniform: GPUBuffer | undefined,
    group: GPUBindGroup | undefined,
    held = UNSET
  return {
    /** The setup's group over the half-size image `first` of `width × height` texels, its uniform
     *  written when the size, the threshold or the layers moved. */
    group(first: GPUTextureView, width: number, height: number, threshold: number, layers: number) {
      uniform ??= device.createBuffer({
        label: BLOOM_PASS,
        size: BLOOM_SETUP_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      if (
        held.width !== width ||
        held.height !== height ||
        held.threshold !== threshold ||
        held.layers !== layers
      ) {
        held = { width, height, threshold, layers }
        words[BLOOM_SETUP.at.outTexel] = 1 / width
        words[BLOOM_SETUP.at.outTexel + 1] = 1 / height
        words[BLOOM_SETUP.at.threshold] = threshold
        words[BLOOM_SETUP.at.layers] = layers
        device.queue.writeBuffer(uniform, 0, words)
      }
      identity.next[0] = first
      identity.next[1] = uniform
      if (identity.moved()) {
        group = device.createBindGroup({
          layout: filters.layouts.down,
          entries: sequentialEntries([
            first,
            filters.clamped,
            { buffer: uniform, size: BLOOM_SETUP_BYTES },
          ]),
        })
      }
      return group!
    },
    release() {
      if (uniform) retire(device, uniform)
      uniform = group = undefined
      held = UNSET
      identity.clear()
    },
  }
}

/**
 * THE BLOOM'S SETUP: the half-size image brought through its local exposure and its threshold into
 * an image of its own, and the levels of the chain under it (`BloomTargets`).
 */
function createBloomSetup(device: GPUDevice, programs: BloomPrograms, targets: BloomTargets) {
  const group = createSetupGroup(device, programs.filters)
  const draw = fullscreenDraw(BLOOM_PASS)
  return {
    /** Draws the setup of the half-size image of the scene's chain `post` shares, and the chain
     *  under it; returns the setup's image. */
    encode(encoder: GPUCommandEncoder, bloom: Bloom, post: PostFrame) {
      const { scene } = post,
        half = scene.size(0)
      const image = targets.setupView(half[0], half[1])
      const reads = group.group(
        scene.view(0)!,
        half[0],
        half[1],
        bloom.threshold,
        Number(post.local),
      )
      draw(encoder, image, programs.setup, reads, post.layers)
      targets.chain.resize(half[0], half[1], BLOOM_LEVEL_COUNT)
      targets.chain.encode(encoder, image, BLOOM_LEVEL_COUNT)
      return image
    },
    release: group.release,
  }
}

/** The finest level that draws — its size past `BLOOM_LEVEL_LEAST` —, -1 when none does. */
function finestLevel(levels: Bloom['levels']) {
  for (let level = 0; level < BLOOM_LEVEL_COUNT; level++)
    if (levels[level].size > BLOOM_LEVEL_LEAST) return level
  return -1
}

/**
 * THE BLURS OF A BLOOM'S LEVELS: a Gaussian stage for each, over the targets the chain's blooms
 * share (`BloomTargets`). `draw` blurs each level that draws, widest first, the stage's sum adding
 * the one below's glow, tinted.
 */
function createBloomLevels(device: GPUDevice, targets: BloomTargets) {
  const stages = targets.stages.map((shared) =>
    createGaussianStage(device, { edge: 'zero', targets: shared }),
  )
  const tint = [0, 0, 0]
  return {
    /** The blur of `level`, at the size of that level. */
    view: (level: number) => stages[level].view,
    /** Blurs each level of `bloom` that draws, its image `from.view(level)` — the level 0's is
     *  `first` —; returns the render passes drawn. */
    draw(encoder: GPUCommandEncoder, bloom: Bloom, from: Levels, first: GPUTextureView) {
      const scale = bloomTintScale(bloom.intensity)
      let below: GPUTextureView | undefined,
        drawn = 0
      for (let level = BLOOM_LEVEL_COUNT - 1; level >= 0; level--) {
        const { size, tint: color } = bloom.levels[level]
        if (!(size > BLOOM_LEVEL_LEAST)) continue
        const across = from.size(level)
        for (let c = 0; c < 3; c++) tint[c] = color[c] * scale
        stages[level].resize(across[0], across[1], size * bloom.sizeScale, tint, !!below)
        stages[level].encode(encoder, level ? from.view(level)! : first, below)
        below = stages[level].view
        drawn += 2
      }
      return drawn
    },
    dispose() {
      for (const stage of stages) stage.dispose()
    },
  }
}

/**
 * ONE BLOOM'S PASSES, over the images the chain's blooms share (`BloomTargets`). The half-size
 * image is brought through a setup — its local exposure applied and a threshold, when the
 * settings need either — into the levels of the setup's chain, or, when they need neither, read
 * from the scene's chain as it is (`PostFrame`, shared with the local exposure). Each level that
 * draws is blurred (`createBloomLevels`), widest first, the stage's sum adding the one below's:
 * the glow is the finest level's. A bloom holds its own uniforms and bind groups, kept while the
 * size and its settings hold, and a frame allocates none.
 */
export function createBloomSet(device: GPUDevice, programs: BloomPrograms, targets: BloomTargets) {
  const levels = createBloomLevels(device, targets)
  const setup = createBloomSetup(device, programs, targets)
  let glow: GPUTextureView | undefined,
    setupUsed = false
  return {
    /** The glow the last `encode` drew: the finest level's blur, none when nothing drew. */
    get view() {
      return glow
    },
    /** Whether the last `encode` drew a setup, and so the chain under it. */
    get usedSetup() {
      return setupUsed
    },
    /**
     * Draws `bloom`'s glow over the frame's image, into the scene's chain `post` shares; returns
     * the render passes drawn, 0 when every level is left out. The setup is drawn where the
     * threshold or the local exposure asks for it; the chain below it, and the blurs, at the sizes
     * of the scene's own levels.
     */
    encode(encoder: GPUCommandEncoder, bloom: Bloom, post: PostFrame) {
      const finest = finestLevel(bloom.levels)
      glow = undefined
      setupUsed = false
      if (finest < 0) return 0
      const withSetup = bloom.threshold > -1 || post.local
      const { scene } = post
      scene.need(withSetup ? 1 : BLOOM_LEVEL_COUNT)
      let drawn = 0,
        first = scene.view(0)!
      if (withSetup) {
        first = setup.encode(encoder, bloom, post)
        drawn = BLOOM_LEVEL_COUNT // the setup, and the five levels under it
        setupUsed = true
      }
      const from = withSetup ? targets.chain : scene
      drawn += levels.draw(encoder, bloom, from, first)
      glow = levels.view(finest)
      return drawn
    },
    dispose() {
      setup.release()
      glow = undefined
      levels.dispose()
    },
  }
}
