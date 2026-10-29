import {
  COMPUTE,
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import {
  cubeFilterLayouts,
  cubeFilterStages,
} from '../../modules/sky/skyLight/cubeFilterPipelines.ts'
import { askedPipelines } from '../../modules/sky/skyLight/askedPipelines.ts'
import { SKY_LIGHT_CUBE_FORMAT } from '../../modules/sky/skyLight/layout.ts'
import {
  CAPTURE_COPY_CODE,
  CAPTURE_COPY_ENTRY,
  CAPTURE_COPY_LAYOUT,
  CAPTURE_DIFFUSE_CODE,
  CAPTURE_DIFFUSE_ENTRIES,
  CAPTURE_DIFFUSE_LAYOUT,
} from './captureWgsl.ts'

/**
 * THE PIPELINES OF A REFLECTION CAPTURE'S OWN PASSES, asked at once, off the frame: the face copy and the three diffuse programs
 * (`captureWgsl.ts`), and the cube passes every capture shares with the sky light's (`cubeFilterStages`): the mips, the roughness filter and the harmonics' sum.
 */
export function createReflectionCapturePipelines(
  device: GPUDevice,
  failed: (error: unknown) => void,
) {
  const FRAGMENT = GPUShaderStage.FRAGMENT
  const { draw, compute } = askedPipelines(device, failed)
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  const layouts = {
    scene: layout([
      computeTextureEntry(0, 'float', '2d', FRAGMENT),
      computeSamplerEntry(1, 'filtering', FRAGMENT),
      computeTextureEntry(2, 'depth', '2d', FRAGMENT),
    ]),
    copy: layout([
      computeUniformEntry(
        0,
        { hasDynamicOffset: true, minBindingSize: CAPTURE_COPY_LAYOUT.words * 4 },
        FRAGMENT,
      ),
    ]),
    diffuse: layout([
      computeUniformEntry(0, { minBindingSize: CAPTURE_DIFFUSE_LAYOUT.words * 4 }, COMPUTE),
      computeBufferEntry(1, 'uniform', COMPUTE),
      computeTextureEntry(2, 'float', '2d-array', COMPUTE),
      computeStorageTextureEntry(3, SKY_LIGHT_CUBE_FORMAT, 'write-only', '2d-array'),
    ]),
  }
  const copyModule = device.createShaderModule({
    label: 'Trillion3D reflection capture copy',
    code: CAPTURE_COPY_CODE,
  })
  const diffuseModule = device.createShaderModule({
    label: 'Trillion3D reflection capture diffuse',
    code: CAPTURE_DIFFUSE_CODE,
  })
  const diffuse = (entry: string, label: string) =>
    compute(diffuseModule, layouts.diffuse, entry, label)
  const cubeLayouts = cubeFilterLayouts(device)
  return {
    layouts,
    cube: { layouts: cubeLayouts, pipelines: cubeFilterStages(device, compute, cubeLayouts) },
    copy: draw(
      copyModule,
      [layouts.scene, layouts.copy],
      CAPTURE_COPY_ENTRY,
      { format: SKY_LIGHT_CUBE_FORMAT },
      'Trillion3D reflection capture copy',
    ),
    sh: diffuse(CAPTURE_DIFFUSE_ENTRIES.sh, 'Trillion3D reflection capture harmonics cube'),
    reference: diffuse(
      CAPTURE_DIFFUSE_ENTRIES.reference,
      'Trillion3D reflection capture irradiance',
    ),
    halve: diffuse(CAPTURE_DIFFUSE_ENTRIES.halve, 'Trillion3D reflection capture halve'),
  }
}

/** What `createReflectionCapturePipelines` made. */
export type ReflectionCapturePipelines = ReturnType<typeof createReflectionCapturePipelines>
