import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { askedPipelines } from '../../modules/sky/skyLight/askedPipelines.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { inputEntries } from '../screenSpaceTracing/pipelines.ts'
import {
  PLANAR_COMPOSITE_BINDING,
  PLANAR_COMPOSITE_CODE,
  PLANAR_COMPOSITE_ENTRY,
  PLANAR_COMPOSITE_LAYOUT,
  PLANAR_PREFILTER_CODE,
  PLANAR_PREFILTER_ENTRY,
  PLANAR_PREFILTER_LAYOUT,
} from './wgsl.ts'

/** The blend of the composite: the colour laid over what the reflection holds (one, one minus the source's alpha); the alpha the largest of the
 *  two (`'scene'`, where the reflection holds the rays' share), or the reflection's own (`'screen'`, where it already holds the environment). */
const compositeTarget = (alpha: 'scene' | 'screen'): GPUColorTargetState => ({
  format: HDR_FORMAT,
  blend: {
    color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    alpha:
      alpha === 'scene'
        ? { operation: 'max', srcFactor: 'one', dstFactor: 'one' }
        : { operation: 'add', srcFactor: 'zero', dstFactor: 'one' },
  },
})

/**
 * THE PIPELINES OF THE PLANAR REFLECTIONS, asked at once, off the frame, a compile that fails handed to `failed`: the prefilter into the reflection image and the composite
 * over the reflection target, in its two blends (`compositeTarget`).
 */
export function createPlanarPipelines(device: GPUDevice, failed: (error: unknown) => void) {
  const { draw } = askedPipelines(device, failed)
  const FRAGMENT = GPUShaderStage.FRAGMENT
  const layouts = {
    prefilter: device.createBindGroupLayout({
      label: 'Trillion3D planar reflection prefilter',
      entries: [
        computeTextureEntry(0, 'float', '2d', FRAGMENT),
        computeSamplerEntry(1, 'filtering', FRAGMENT),
        computeTextureEntry(2, 'depth', '2d', FRAGMENT),
        computeUniformEntry(3, { minBindingSize: PLANAR_PREFILTER_LAYOUT.words * 4 }, FRAGMENT),
      ],
    }),
    composite: device.createBindGroupLayout({
      label: 'Trillion3D planar reflection composite',
      entries: [
        ...inputEntries(FRAGMENT),
        computeUniformEntry(
          PLANAR_COMPOSITE_BINDING,
          { minBindingSize: PLANAR_COMPOSITE_LAYOUT.words * 4 },
          FRAGMENT,
        ),
      ],
    }),
  }
  const prefilterModule = device.createShaderModule({
    label: 'Trillion3D planar reflection prefilter',
    code: PLANAR_PREFILTER_CODE,
  })
  const compositeModule = device.createShaderModule({
    label: 'Trillion3D planar reflection composite',
    code: PLANAR_COMPOSITE_CODE,
  })
  const composite = (alpha: 'scene' | 'screen') =>
    draw(
      compositeModule,
      [layouts.composite],
      PLANAR_COMPOSITE_ENTRY,
      compositeTarget(alpha),
      `Trillion3D planar reflection composite ${alpha}`,
    )
  return {
    layouts,
    prefilter: draw(
      prefilterModule,
      [layouts.prefilter],
      PLANAR_PREFILTER_ENTRY,
      { format: HDR_FORMAT },
      'Trillion3D planar reflection prefilter',
    ),
    composite: { scene: composite('scene'), screen: composite('screen') },
  }
}

/** What `createPlanarPipelines` made. */
export type PlanarPipelines = ReturnType<typeof createPlanarPipelines>
