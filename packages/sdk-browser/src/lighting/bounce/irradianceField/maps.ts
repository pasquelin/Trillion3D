import type { IrradianceFieldSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import { namedEntries, wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { POOL_ARGS } from '../pool/poolLayout.ts'
import { POOL_ROW_PROBES } from '../atlas.ts'
import type { AfterUpdate } from '../cache/radianceCache.ts'
import {
  IRRADIANCE_BINDINGS,
  FIELD_OCCLUSION_FORMAT,
  irradianceFieldFormat,
  OCCLUSION_BINDINGS,
  FIELD_MAP_BORDER,
  irradianceEntries,
  irradianceProgram,
  occlusionEntries,
  occlusionProgram,
} from './mapsWgsl.ts'
import { irradianceFieldAtlases } from './shape.ts'

/** The kernels of the field's maps for a device, made off the frame (the pipelines of an unready field are not asked for). */
async function buildKernels(
  device: GPUDevice,
  field: IrradianceFieldSettings,
  light: LightAtlasFormat,
) {
  const make = async <E extends string>(
    label: string,
    code: string,
    entries: GPUBindGroupLayoutEntry[],
    entry: E,
  ) => {
    const layout = device.createBindGroupLayout({ label: `Trillion3D ${label}`, entries })
    const module = await createCheckedShaderModule(device, code, label)
    const stages = await buildComputeStages(device, [layout], module, [entry])
    return { layout, pipeline: stages[entry] }
  }
  const [irradiance, occlusion] = await Promise.all([
    make(
      'irradiance field irradiance',
      irradianceProgram(field.irradianceResolution, light),
      irradianceEntries(light),
      'irradianceMaps',
    ),
    make(
      'irradiance field occlusion',
      occlusionProgram(field.occlusionResolution, light),
      occlusionEntries(),
      'occlusionMaps',
    ),
  ])
  return { irradiance, occlusion }
}

type Kernels = Awaited<ReturnType<typeof buildKernels>>
type UpdateInputs = Parameters<AfterUpdate>[1]

/** The atlases of the field's maps and the buffer of its probes' validity: whether each probe stands outside every surface, a word a probe by its slot
 *  (`fieldProbeOutside`), none until the occlusion pass has made one. */
function createAtlases(
  device: GPUDevice,
  field: IrradianceFieldSettings,
  slots: number,
  light: LightAtlasFormat,
) {
  const { irradiance, occlusion } = irradianceFieldAtlases(field, POOL_ROW_PROBES, slots)
  const atlas = (label: string, extent: readonly [number, number], format: GPUTextureFormat) =>
    device.createTexture({
      label: `Trillion3D irradiance field ${label} v1`,
      size: [...extent],
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
  const irradianceAtlas = atlas('irradiance', irradiance, irradianceFieldFormat(light))
  const occlusionAtlas = atlas('occlusion', occlusion, FIELD_OCCLUSION_FORMAT)
  const valid = device.createBuffer({
    label: 'Trillion3D irradiance field probe validity v1',
    size: Math.max(slots, 1) * 4,
    usage: GPUBufferUsage.STORAGE,
  })
  return {
    views: {
      irradiance: irradianceAtlas.createView(),
      occlusion: occlusionAtlas.createView(),
      valid,
    },
    dispose() {
      irradianceAtlas.destroy()
      occlusionAtlas.destroy()
      valid.destroy()
    },
  }
}

/** The bind groups of the two kernels over the cache's storage and wiring of this update. */
function createGroups(
  device: GPUDevice,
  kernels: Kernels,
  views: ReturnType<typeof createAtlases>['views'],
  { wiring, storage, reads }: UpdateInputs,
) {
  const common = {
    grid: wholeBuffer(wiring.grid),
    table: wiring.table,
    queue: wholeBuffer(wiring.queue),
    params: wholeBuffer(storage.params),
  }
  return {
    irradiance: device.createBindGroup({
      layout: kernels.irradiance.layout,
      entries: namedEntries(IRRADIANCE_BINDINGS, {
        ...common,
        final: storage.views.levels[0],
        irradiance: views.irradiance,
      }),
    }),
    occlusion: device.createBindGroup({
      layout: kernels.occlusion.layout,
      entries: [
        ...namedEntries(OCCLUSION_BINDINGS, {
          ...common,
          raw: storage.views.raw,
          occlusion: views.occlusion,
          valid: wholeBuffer(views.valid),
        }),
        ...reads.field.readEntries(OCCLUSION_BINDINGS.field),
      ],
    }),
  }
}

/**
 * THE FIELD'S MAPS: the irradiance and occlusion atlases of the probes of the irradiance field's cache, and the pass that makes them (`IRRADIANCE_PROGRAM`, `OCCLUSION_PROGRAM`) for the
 * probes the cache's update queued, in the same compute pass, right after the final maps are made. `views` are the atlases while the kernels are ready and the cache made its maps,
 * none else; `dispose` destroys them. A change of the maps' resolutions makes a field of maps again (`IrradianceFieldHold`'s key holds them).
 */
export function createFieldMaps(
  device: GPUDevice,
  field: IrradianceFieldSettings,
  slots: number,
  /** The format the cache's final maps, which the irradiance is made from, are stored in. */
  light: LightAtlasFormat,
) {
  const atlases = createAtlases(device, field, slots, light)
  const { views } = atlases
  let kernels: Kernels | undefined
  let disposed = false
  void buildKernels(device, field, light).then((built) => {
    if (!disposed) kernels = built
  })
  const identity = createWebgpuBindIdentity()
  let groups: ReturnType<typeof createGroups> | undefined
  const after: AfterUpdate = (pass, inputs) => {
    if (!kernels) return
    const { next } = identity
    next[0] = inputs.storage
    next[1] = inputs.reads.field.readGeneration
    if (identity.moved() || !groups) groups = createGroups(device, kernels, views, inputs)
    pass.setPipeline(kernels.irradiance.pipeline)
    pass.setBindGroup(0, groups.irradiance)
    pass.dispatchWorkgroupsIndirect(inputs.args, POOL_ARGS.probes * 4)
    pass.setPipeline(kernels.occlusion.pipeline)
    pass.setBindGroup(0, groups.occlusion)
    pass.dispatchWorkgroupsIndirect(inputs.args, POOL_ARGS.probes * 4)
  }
  return {
    views,
    after,
    /** The border of the maps, in texels all round a probe's square. */
    border: FIELD_MAP_BORDER,
    dispose() {
      disposed = true
      atlases.dispose()
    },
  }
}

/** The field's maps, made. */
export type FieldMaps = ReturnType<typeof createFieldMaps>
