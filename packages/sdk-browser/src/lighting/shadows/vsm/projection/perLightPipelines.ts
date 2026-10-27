/**
 * THE PER-LIGHT PATH'S PIPELINE (`perLightPass.ts`), made for a pool layout at the first light that asks: the
 * projection's compute pipeline (`perLightProjectionWgsl.ts`) with its group layout. It is the projection's own
 * (`projectionPipelines.ts`): its view and tables group, its shared bindings.
 */
import {
  computeStorageTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { gpuCapsOf, nativeOrPolyfill } from '../../../../gpu/core/gpuCaps.ts'
import { hasSubgroupsOf } from '../../../../gpu/core/subgroups.ts'
import { preparedComputePipeline, type PreparedPipeline } from '../../../deferred/fullscreen.ts'
import { PER_LIGHT_MASK_FORMAT } from './maskFormat.ts'
import { VSM_PER_LIGHT_ENTRY, vsmPerLightProjectionWgsl } from './perLightProjectionWgsl.ts'
import { PER_LIGHT_RECORD_BINDING_BYTES } from './perLightRecord.ts'
import { VSM_PROJECTION_HALF_LANES } from './projectionPixelWgsl.ts'
import { sharedEntries, VSM_PROJECTION_PASS, type Pipelines } from './projectionPipelines.ts'
import { VSM_PROJECTION_BINDING } from './projectionWgsl.ts'

/** The per-light path's pipeline for one pool layout. */
export interface PerLightPipelines {
  /** The projection's group layout (group 1, beside the tables') and its pipeline. */
  projectionLayout: GPUBindGroupLayout
  projection: PreparedPipeline<GPUComputePipeline>
}

/** The per-light pipeline of `p`, made at its first ask. */
export function perLightPipelinesOf(p: Pipelines): PerLightPipelines {
  if (p.perLight) return p.perLight
  const { device } = p
  const projectionLayout = device.createBindGroupLayout({
    label: 'vsm.projection.perLight',
    entries: [
      ...sharedEntries(),
      computeStorageTextureEntry(
        VSM_PROJECTION_BINDING.mask,
        PER_LIGHT_MASK_FORMAT,
        'write-only',
        '2d-array',
      ),
      computeUniformEntry(VSM_PROJECTION_BINDING.perLight, {
        hasDynamicOffset: true,
        minBindingSize: PER_LIGHT_RECORD_BINDING_BYTES,
      }),
    ],
  })
  const label = `vsm.projection.perLight (${nativeOrPolyfill(gpuCapsOf(device), 'subgroups').tag})`
  // The halves vote over their subgroups where every subgroup is a half (`hasSubgroupsOf`).
  const subgroups = hasSubgroupsOf(device, VSM_PROJECTION_HALF_LANES)
  return (p.perLight = {
    projectionLayout,
    projection: preparedComputePipeline(device, {
      label: VSM_PROJECTION_PASS,
      layout: device.createPipelineLayout({ bindGroupLayouts: [p.vsmLayout, projectionLayout] }),
      compute: {
        module: device.createShaderModule({
          label,
          code: vsmPerLightProjectionWgsl(p.layout, subgroups),
        }),
        entryPoint: VSM_PER_LIGHT_ENTRY,
      },
    }),
  })
}
