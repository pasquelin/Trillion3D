import { computeTextureEntry, computeUniformEntry } from '../gpu/core/computeBindings.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../gpu/shader/fullscreenTriangle.ts'
import { fullscreenDescriptor, preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { wordsOf } from '../gpu/core/wordViews.ts'

/**
 * THE PASSES THAT READ A TEXTURE AT THE TEXEL UNDER THE PIXEL, no filter, for the layers drawn smaller than the image
 * (`translucencyScale.ts`): the depth of the scene taken at their size (`translucencyDepth.ts`) and their marks laid over the image's own
 * targets (`translucencyResponsive.ts`). One program text, one uniform (the source's size over the destination's, then the source's last
 * texel) and one group per source view.
 */

/** A program of one entry: the texture `source` (declared as `texture`) read at the texel `at` of the pixel (`index`, an expression of
 *  `pixel` and `span`, `span.xy` the scale), held to the source's last texel `span.zw`; `body` returns `output`. */
export const pointProgram = (
  texture: string,
  output: string,
  entry: string,
  index: string,
  body: string,
) =>
  wgslProgram(
    `
@group(0) @binding(0) var source:${texture};
// The source's size over the destination's, then the source's last texel.
@group(0) @binding(1) var<uniform> span:vec4f;
@fragment fn ${entry}(@builtin(position) pixel:vec4f)->${output}{
 let at=min(vec2i(${index}),vec2i(span.zw));
${body}
}`,
    [FULLSCREEN_VERTEX],
  )

/** The pipeline, uniform and bind groups of one kind of point pass, made once for the device by `pointPass`. */
export interface PointPass {
  layout: GPUBindGroupLayout
  pipeline: ReturnType<typeof preparedPipeline>
  uniform: GPUBuffer
  groups: WeakMap<GPUTextureView, GPUBindGroup>
  floats: Float32Array<ArrayBuffer>
}

/** Makes the point pass `label` of `module`'s `entry`, which reads a texture of `sample` type and draws into `targets` (and `depth`). */
export const pointPass = (
  device: GPUDevice,
  label: string,
  module: GPUShaderModule,
  entry: string,
  sample: GPUTextureSampleType,
  targets: GPUColorTargetState[],
  depth?: GPUDepthStencilState,
): PointPass => {
  const layout = device.createBindGroupLayout({
    label,
    entries: [
      computeTextureEntry(0, sample, '2d', GPUShaderStage.FRAGMENT),
      computeUniformEntry(1, {}, GPUShaderStage.FRAGMENT),
    ],
  })
  return {
    layout,
    pipeline: preparedPipeline(device, {
      ...fullscreenDescriptor(device, module, layout, entry, targets, label),
      ...(depth && { depthStencil: depth }),
    }),
    uniform: device.createBuffer({
      label: `${label} span`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    groups: new WeakMap(),
    floats: new Float32Array(4),
  }
}

/** The group of `source` with the pass's uniform, made once for the view. */
export function pointGroup(
  device: GPUDevice,
  made: Pick<PointPass, 'layout' | 'uniform' | 'groups'>,
  source: GPUTextureView,
  label: string,
) {
  let group = made.groups.get(source)
  if (!group) {
    group = device.createBindGroup({
      label,
      layout: made.layout,
      entries: [
        { binding: 0, resource: source },
        { binding: 1, resource: { buffer: made.uniform } },
      ],
    })
    made.groups.set(source, group)
  }
  return group
}

/** Writes the four words of the pass's uniform. */
export function writePoint(
  device: GPUDevice,
  made: PointPass,
  a: number,
  b: number,
  c: number,
  d: number,
) {
  const { floats } = made
  floats[0] = a
  floats[1] = b
  floats[2] = c
  floats[3] = d
  writeChanged(device, made.uniform, wordsOf(floats), 0, 4)
}
