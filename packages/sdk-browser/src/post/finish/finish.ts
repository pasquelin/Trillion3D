import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { filterPrograms } from '../filters/filterPrograms.ts'
import { createSceneChain, type SceneChain } from '../filters/sceneChain.ts'
import { FINISH, FINISH_BYTES, finishLayout } from './finishLayout.ts'
import { writeFinishParams, type FinishInput } from './finishParams.ts'
import type { ExposureSettings } from '../exposure/meterParams.ts'
import type { FilmValues } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { lazyGrain } from './grain.ts'
import { createLocalExposure } from './local.ts'

/** What a frame's passes before the composition share of the display finishing: the scene's chain
 *  of levels, begun with the frame's image; the finishing's group (`finishLayout`) with nothing in
 *  the slots the local exposure's own passes write (`bare`), and with the layers they wrote, for
 *  the passes that read them (`layers`); `local` says the local exposure was drawn. */
export type PostFrame = {
  scene: SceneChain
  bare: GPUBindGroup
  layers: GPUBindGroup
  local: boolean
}

/** A view's display finishing (`createFinish`). */
export type Finish = ReturnType<typeof createFinish>

/**
 * THE GROUPS OF THE FINISHING'S SLOT 1 (`finishLayout`): the uniform, the local exposure's grid and
 * blurred log luminance, the bloom's glow and the grain's texture with the sampler that repeats
 * it, an empty image where a slot has none. `bare` has none of the four; `of` gives the group over
 * the images it is handed, each combination kept while the images hold, a few at a time. The
 * grain's texture is made, with its sampler, at the first group that asks for it (`grain`): a
 * finishing that draws no grain holds neither.
 */
function createFinishGroups(device: GPUDevice, uniform: GPUBuffer) {
  const layout = finishLayout(device),
    filters = filterPrograms(device)
  const volume = device.createTexture({
    label: 'Trillion3D display finish empty grid',
    size: { width: 1, height: 1, depthOrArrayLayers: 1 },
    dimension: '3d',
    format: HDR_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const emptyGrid = volume.createView({ dimension: '3d' })
  const grain = lazyGrain(device)
  const build = (
    grid?: GPUTextureView,
    blurred?: GPUTextureView,
    glow?: GPUTextureView,
    noise?: GPUTextureView,
  ) =>
    device.createBindGroup({
      layout,
      entries: sequentialEntries([
        { buffer: uniform, size: FINISH_BYTES },
        grid ?? emptyGrid,
        blurred ?? filters.empty,
        filters.clamped,
        glow ?? filters.empty,
        noise ?? filters.empty,
        noise ? grain.sampler() : filters.clamped,
      ]),
    })
  const identity = createWebgpuBindIdentity(4),
    groups: GPUBindGroup[] = []
  return {
    bare: build(),
    /** The view of the grain's texture, made at the first ask. */
    grain: grain.view,
    /** Bytes the grain's texture holds, none until it is made. */
    get bytes() {
      return grain.bytes
    },
    of(
      grid?: GPUTextureView,
      blurred?: GPUTextureView,
      glow?: GPUTextureView,
      noise?: GPUTextureView,
    ) {
      identity.next[0] = grid
      identity.next[1] = blurred
      identity.next[2] = glow
      identity.next[3] = noise
      if (identity.moved()) groups[identity.slot] = build(grid, blurred, glow, noise)
      return groups[identity.slot]
    },
    dispose() {
      volume.destroy()
      grain.dispose()
    },
  }
}

/**
 * A VIEW'S DISPLAY FINISHING: the uniform the bloom's setup and the composition read — the local
 * exposure's settings, the film's and the vignette, the exposure copied from the view's — and the
 * scene's chain and the local exposure's layers built over it. One object for the view: made at
 * the first image that finishes, kept while the view lives.
 */
export function createFinish(device: GPUDevice) {
  const uniform = device.createBuffer({
    label: 'Trillion3D display finish',
    size: FINISH_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Float32Array(FINISH.words),
    image = new Uint32Array(words.buffer)
  const groups = createFinishGroups(device, uniform)
  const scene = createSceneChain(device)
  const local = createLocalExposure(device, uniform, groups.bare)
  // The settings the last image was drawn with: a view that rests is drawn again when they move.
  const used = {} as ExposureSettings,
    usedFilm = {} as FilmValues
  return {
    scene,
    local,
    bare: groups.bare,
    used,
    usedFilm,
    /** Bytes of the scene's chain, the local exposure's layers and the grain's texture. */
    get bytes() {
      return scene.bytes + local.bytes + groups.bytes
    },
    /** Copies the exposure the view's uniform holds, `at` bytes into `view`, into the finishing's:
     *  on the GPU, after an automatic exposure wrote it there. */
    copyExposure(encoder: GPUCommandEncoder, view: GPUBuffer, at: number) {
      encoder.copyBufferToBuffer(view, at, uniform, (FINISH.at.look + 1) * 4, 4)
    },
    /** Writes the uniform for `input`: the words that changed, nothing when none did. */
    write(input: FinishInput) {
      writeFinishParams(words, input)
      writeChanged(device, uniform, image, 0, image.length)
    },
    /** The group the composition reads, over the local exposure's layers when `layers`, the
     *  bloom's `glow` when there is one and the grain's texture when `grain`. */
    groupFor(layers: boolean, glow?: GPUTextureView, grain = false) {
      return groups.of(
        layers ? local.grid : undefined,
        layers ? local.blurred : undefined,
        glow,
        grain ? groups.grain() : undefined,
      )
    },
    dispose() {
      scene.dispose()
      local.dispose()
      uniform.destroy()
      groups.dispose()
    },
  }
}
