import { createCheckedShaderModule } from '../core/shaderModule.ts'
import { BENCHMARK_WGSL } from './benchmarkWgsl.ts'

/** The targets' format: eight bits a channel, blue first. */
export const BENCHMARK_FORMAT: GPUTextureFormat = 'bgra8unorm'
/** Bytes a vertex of the attributes test holds: five four-float attributes. */
export const VERTEX_BYTES = 80

/** The fragment entry of each pixel test, in `GPU_METHODS` order. */
const PIXEL_FRAGMENTS = [
  'aluNoiseFragment',
  'textureFragment',
  'dependentTextureFragment',
  'fillFragment',
  'bandwidthFragment',
]

/** The attributes test's vertex layout: five four-float attributes, locations 0 to 4. */
const ATTRIBUTES: GPUVertexBufferLayout = {
  arrayStride: VERTEX_BYTES,
  attributes: [0, 1, 2, 3, 4].map((location) => ({
    format: 'float32x4' as const,
    offset: location * 16,
    shaderLocation: location,
  })),
}

/** The rectangle's bindings: its height (a dynamic offset into the heights), the target it reads
 *  and the point sampler. */
const rectangleLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D benchmark rectangle',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  })

/**
 * The graphics test's programs on `device`: the bind group layout of the rectangle, one pipeline per
 * test in `GPU_METHODS` order (five pixel tests over the rectangle, two vertex tests whose pixels
 * are black) and the long pass's strip.
 */
export async function createBenchmarkPipelines(device: GPUDevice) {
  const module = await createCheckedShaderModule(device, BENCHMARK_WGSL, 'HARDWARE_BENCHMARK')
  const layout = rectangleLayout(device)
  const withRectangle = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const bare = device.createPipelineLayout({ bindGroupLayouts: [] })
  const targets: GPUColorTargetState[] = [{ format: BENCHMARK_FORMAT }]
  // The pixel tests add into their target: the rectangles of a pass overlap, and a tile-based
  // device shades only the last of overlapped opaque ones; a blended layer is always shaded.
  const additive: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' }
  const blended: GPUColorTargetState[] = [
    { format: BENCHMARK_FORMAT, blend: { color: additive, alpha: additive } },
  ]
  const pipeline = (
    vertex: string,
    fragment: string,
    buffers: GPUVertexBufferLayout[] = [],
    topology: GPUPrimitiveTopology = 'triangle-list',
    colorTargets = targets,
  ) =>
    device.createRenderPipelineAsync({
      label: `Trillion3D benchmark ${vertex} ${fragment}`,
      layout: vertex === 'rectangleVertex' ? withRectangle : bare,
      vertex: { module, entryPoint: vertex, buffers },
      fragment: { module, entryPoint: fragment, targets: colorTargets },
      primitive: { topology, cullMode: 'none' },
    })
  const strip: GPUVertexBufferLayout = {
    arrayStride: 16,
    attributes: [{ format: 'float32x4', offset: 0, shaderLocation: 0 }],
  }
  const [methods, long] = await Promise.all([
    Promise.all([
      ...PIXEL_FRAGMENTS.map((fragment) =>
        pipeline('rectangleVertex', fragment, [], 'triangle-list', blended),
      ),
      pipeline('attributesVertex', 'blackFragment', [ATTRIBUTES]),
      pipeline('vertexIdVertex', 'blackFragment'),
    ]),
    pipeline('longVertex', 'longFragment', [strip], 'triangle-strip'),
  ])
  return { layout, methods, long }
}
