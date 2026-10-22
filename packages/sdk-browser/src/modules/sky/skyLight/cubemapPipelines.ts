import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import {
  COPY_CODE,
  COPY_ENTRY,
  COPY_LAYOUT,
  COPY_SCENE_ENTRY,
  LUMINANCE_CODE,
  LUMINANCE_ENTRIES,
  LUMINANCE_FORMAT,
} from './copyWgsl.ts'
import { askedPipelines } from './askedPipelines.ts'
import { SKY_LIGHT_CUBE_FORMAT } from './layout.ts'

const FRAGMENT = 2

/** The bind group layouts of the cubemap's passes. */
function cubemapLayouts(device: GPUDevice) {
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  return {
    /** The host's cube, read bilinearly. */
    source: layout([
      computeTextureEntry(0, 'float', 'cube', FRAGMENT),
      computeSamplerEntry(1, 'filtering', FRAGMENT),
    ]),
    /** The lit image of the scene drawn for a face, read bilinearly. */
    scene: layout([
      computeTextureEntry(2, 'float', '2d', FRAGMENT),
      computeSamplerEntry(3, 'filtering', FRAGMENT),
    ]),
    /** The copy's block, one slot to a face, read at a dynamic offset. */
    block: layout([
      computeUniformEntry(
        0,
        { hasDynamicOffset: true, minBindingSize: COPY_LAYOUT.words * 4 },
        FRAGMENT,
      ),
    ]),
    /** A mip of the 32-bit float cube from the one above it. */
    downsample: layout([
      computeUniformEntry(0, { hasDynamicOffset: true, minBindingSize: 16 }),
      computeTextureEntry(1, 'unfilterable-float', 'cube'),
      computeSamplerEntry(2, 'non-filtering'),
      computeStorageTextureEntry(3, LUMINANCE_FORMAT, 'write-only', '2d-array'),
    ]),
    /** The brightest value of the last mip, into a buffer. */
    gather: layout([
      computeUniformEntry(0, { hasDynamicOffset: true, minBindingSize: 16 }),
      computeTextureEntry(1, 'unfilterable-float', 'cube'),
      computeSamplerEntry(2, 'non-filtering'),
      computeBufferEntry(4, 'storage'),
    ]),
  }
}

/**
 * THE LAYOUTS AND PIPELINES OF A SPECIFIED CUBEMAP AND OF A CAPTURED SCENE, made when the first one
 * is captured, not before: the copy of the host's cube into the faces of the captured cube
 * (`copyFaceMain`, written into a 16-bit cube, and into a 32-bit float one for the brightest
 * value), the two programs that find that value (`maxDownsampleMain`, `maxGatherMain`) and the
 * copy of the scene's lit image into a face (`copySceneFaceMain`). Nothing of them is compiled by a
 * light that captures its sky in real time.
 */
export function createCubemapPipelines(device: GPUDevice, failed: (error: unknown) => void) {
  const layouts = cubemapLayouts(device)
  const { draw, compute } = askedPipelines(device, failed)
  const copyModule = device.createShaderModule({
    label: 'Trillion3D sky light cubemap copy',
    code: COPY_CODE,
  })
  const luminanceModule = device.createShaderModule({
    label: 'Trillion3D sky light cubemap brightness',
    code: LUMINANCE_CODE,
  })
  const copy = (format: GPUTextureFormat, label: string) =>
    draw(copyModule, [layouts.source, layouts.block], COPY_ENTRY, { format }, label)
  const pipelines = {
    copy: copy(SKY_LIGHT_CUBE_FORMAT, 'Trillion3D sky light cubemap copy'),
    copyWide: copy(LUMINANCE_FORMAT, 'Trillion3D sky light cubemap copy, 32-bit'),
    copyScene: draw(
      copyModule,
      [layouts.scene, layouts.block],
      COPY_SCENE_ENTRY,
      { format: SKY_LIGHT_CUBE_FORMAT },
      'Trillion3D sky light scene copy',
    ),
    downsample: compute(
      luminanceModule,
      layouts.downsample,
      LUMINANCE_ENTRIES.downsample,
      'Trillion3D sky light cubemap brightness mips',
    ),
    gather: compute(
      luminanceModule,
      layouts.gather,
      LUMINANCE_ENTRIES.gather,
      'Trillion3D sky light cubemap brightness',
    ),
  }
  return {
    layouts,
    pipelines,
    /** Whether the pipelines a cube of `wide` (32-bit float) texels needs are compiled. */
    ready: (wide: boolean) =>
      pipelines.copy.ready &&
      (!wide || (pipelines.copyWide.ready && pipelines.downsample.ready && pipelines.gather.ready)),
    /** Whether the copy of a scene's lit image is compiled. */
    sceneReady: () => pipelines.copyScene.ready,
  }
}

/** What `createCubemapPipelines` made. */
export type CubemapPipelines = ReturnType<typeof createCubemapPipelines>
