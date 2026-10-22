import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../../lighting/deferred/fullscreen.ts'
import {
  COPY_CODE,
  COPY_ENTRY,
  COPY_LAYOUT,
  LUMINANCE_CODE,
  LUMINANCE_ENTRIES,
  LUMINANCE_FORMAT,
} from './copyWgsl.ts'
import { SKY_LIGHT_CUBE_FORMAT } from './layout.ts'

const FRAGMENT = 2

/**
 * THE LAYOUTS AND PIPELINES OF A SPECIFIED CUBEMAP, made when the first one is captured, not before:
 * the copy of the host's cube into the faces of the captured cube (`copyFaceMain`, written into a
 * 16-bit cube, and into a 32-bit float one for the brightest value) and the two programs that find
 * that value (`maxDownsampleMain`, `maxGatherMain`). Nothing of them is compiled by a light that
 * captures its sky in real time.
 */
export function createCubemapPipelines(device: GPUDevice, failed: (error: unknown) => void) {
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  const layouts = {
    /** The host's cube, read bilinearly. */
    source: layout([
      computeTextureEntry(0, 'float', 'cube', FRAGMENT),
      computeSamplerEntry(1, 'filtering', FRAGMENT),
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
  const copyModule = device.createShaderModule({
    label: 'Trillion3D sky light cubemap copy',
    code: COPY_CODE,
  })
  const copy = (format: GPUTextureFormat, label: string) => {
    const pipeline = preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        copyModule,
        [layouts.source, layouts.block],
        COPY_ENTRY,
        [{ format }],
        label,
      ),
    ).ask()
    pipeline.prepare().catch(failed)
    return pipeline
  }
  const luminanceModule = device.createShaderModule({
    label: 'Trillion3D sky light cubemap brightness',
    code: LUMINANCE_CODE,
  })
  const compute = (group: GPUBindGroupLayout, entry: string, label: string) => {
    const pipeline = preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [group] }),
      luminanceModule,
      entry,
      undefined,
      label,
    ).ask()
    pipeline.prepare().catch(failed)
    return pipeline
  }
  const pipelines = {
    copy: copy(SKY_LIGHT_CUBE_FORMAT, 'Trillion3D sky light cubemap copy'),
    copyWide: copy(LUMINANCE_FORMAT, 'Trillion3D sky light cubemap copy, 32-bit'),
    downsample: compute(
      layouts.downsample,
      LUMINANCE_ENTRIES.downsample,
      'Trillion3D sky light cubemap brightness mips',
    ),
    gather: compute(
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
  }
}

/** What `createCubemapPipelines` made. */
export type CubemapPipelines = ReturnType<typeof createCubemapPipelines>
