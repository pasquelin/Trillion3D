import { SHADE_BINDINGS, atlasLayoutEntries } from '../../gpu/bind/bindLayout.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import { classIdentity, graphClassOf } from '../../materials/graph/surfaceClasses.ts'
import { SHADE_UNIFORM_BYTES } from '../../visibility/shader/request.ts'
import { pipelineLayoutOf, preparedComputePipeline } from '../deferred/fullscreen.ts'
import { PT_SHADE_ENTRY, PT_SHADE_PATHS, shadeHitProgram } from './shadeHitWgsl.ts'
import { PT_VIEW } from './viewWgsl.ts'

/** The bindings of the resolve's group 0 the hits' shade keeps: the maps' pools and page tables, their sampler, the image's uniform and the surfaces' records. */
export const PT_SHADE_RESOURCE_BINDINGS: ReadonlySet<number> = new Set([
  ...SHADE_BINDINGS.color.lanes,
  SHADE_BINDINGS.color.pages,
  SHADE_BINDINGS.sampler,
  SHADE_BINDINGS.uniform,
  ...SHADE_BINDINGS.data.lanes,
  SHADE_BINDINGS.data.pages,
  SHADE_BINDINGS.material,
])

/**
 * THE PIPELINES OF THE SHADE OF THE HITS, one for each class of surfaces (`shadeHitProgram`): the layouts of the two groups — the resolve's resources it keeps (group 0, the entries of the resolve's own group of
 * the same bindings) and the paths' (group 1: the parameters, the queue, the hits and the materials) —, and for a class key the pipeline that shades the hits of that class, its features the resolve's overrides, the module
 * of a graph's program shared by every class of the program, each prepared off the frame.
 */
const hitShadePipelinesMade = (device: GPUDevice, weighted: boolean) => {
  const b = SHADE_BINDINGS
  const resources = device.createBindGroupLayout({
    label: 'Trillion3D path tracer hit shade resources',
    entries: [
      ...atlasLayoutEntries(b.color, COMPUTE),
      computeSamplerEntry(b.sampler, 'filtering'),
      computeUniformEntry(b.uniform, { minBindingSize: SHADE_UNIFORM_BYTES }),
      ...atlasLayoutEntries(b.data, COMPUTE),
      computeTextureEntry(b.material, 'uint', '2d-array'),
    ],
  })
  const paths = device.createBindGroupLayout({
    label: 'Trillion3D path tracer hit shade paths',
    entries: [
      computeUniformEntry(PT_SHADE_PATHS.view, {
        hasDynamicOffset: true,
        minBindingSize: PT_VIEW.words * 4,
      }),
      computeBufferEntry(PT_SHADE_PATHS.queue, 'storage'),
      computeBufferEntry(PT_SHADE_PATHS.hits, 'read-only-storage'),
      computeBufferEntry(PT_SHADE_PATHS.materials, 'storage'),
      // The choice among closures reads the ray's direction and the lights' energy table.
      ...(weighted
        ? [
            computeBufferEntry(PT_SHADE_PATHS.states, 'read-only-storage'),
            computeBufferEntry(PT_SHADE_PATHS.lights, 'read-only-storage'),
          ]
        : []),
    ],
  })
  const layout = pipelineLayoutOf(device, [resources, paths])
  const plain = device.createShaderModule({
    label: 'Trillion3D path tracer hit shade',
    code: shadeHitProgram(undefined, weighted),
  })
  // By the graph program's text: every class of the program shares its module.
  const graphModules = new Map<string, GPUShaderModule>()
  const moduleOf = (key: number) => {
    const graph = graphClassOf(key)
    if (!graph) return plain
    const { compiled } = graph.program
    let module = graphModules.get(compiled.key)
    if (!module)
      graphModules.set(
        compiled.key,
        (module = device.createShaderModule({
          label: 'Trillion3D path tracer hit shade graph',
          code: shadeHitProgram(compiled, weighted),
        })),
      )
    return module
  }
  const classes = preparedPipelines((key: number) => {
    const graph = graphClassOf(key)
    const constants: Record<string, number> = {
      CLASS_KEY: graph?.features ?? key,
      HIT_CLASS: key,
      FEEDBACK: 0,
      EMISSIVE_AO: 0,
    }
    if (graph) constants.CLASS_BIN = key
    return preparedComputePipeline(device, {
      layout,
      compute: { module: moduleOf(key), entryPoint: PT_SHADE_ENTRY, constants },
    })
  }, classIdentity)
  return { layouts: [resources, paths] as const, weighted, of: classes.of, prune: classes.prune }
}

export const hitShadePipelinesOf = oncePerDevice((device: GPUDevice) =>
  hitShadePipelinesMade(device, false),
)

/** The same pipelines for a view whose pixels hold several closures: the shade of a hit chooses one closure of its material and writes the weight of the choice beside the record (`ptHitMaterialStride`). */
export const weightedHitShadePipelinesOf = oncePerDevice((device: GPUDevice) =>
  hitShadePipelinesMade(device, true),
)
