import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts'
import { makeFullscreenPipeline } from '../lighting/deferred/fullscreen.ts'
import { reflectionLayout, reflectionOwnerLayout, reflectionResolveLayout } from './layout.ts'
import { withScreenReflections } from './screenWgsl.ts'
import { withReflectionSourceOutput } from './sourceOutputWgsl.ts'
import { REFLECTION_SOURCE_WGSL, reflectionSourceLayout } from './sourceWgsl.ts'
import { stochasticReflectionShader } from './sampleWgsl.ts'
import { REFLECTION_RESOLVE_WGSL } from './resolveWgsl.ts'
import { reflectionBoundsPipelines } from './boundsPyramid.ts'
import type { LitProgram } from '../lighting/deferred/shaders.ts'

/** The source reprojects the last image's unfogged colour, which the final pass writes as its
 * second target (`sourceOutputWgsl.ts`): no pass here lights a surface but the final one. Source
 * and final resolve are separate programs: no uniform can change between two encoded passes
 * through queue.writeBuffer before their shared submission. The four compile together, off the
 * thread, with the depth bounds' reductions: the lit program the first image waits for is
 * its slowest one, never their sum. */
export async function reflectionPipelines(
  device: GPUDevice,
  lit: LitProgram,
  layout: GPUBindGroupLayout,
  { unboundedReflections = false }: { unboundedReflections?: boolean } = {},
) {
  const targets: GPUColorTargetState[] = [{ format: 'rgba16float' }]
  const resolveLayout = reflectionResolveLayout(device)
  // Each module is checked where its text is named: the shader sweep reads the call
  // (`engineShaders.test.ts`).
  const program = async (
    module: Promise<GPUShaderModule>,
    bind: GPUBindGroupLayout | readonly GPUBindGroupLayout[],
    entryPoint: string,
    into = targets,
  ) => makeFullscreenPipeline(device, await module, bind, entryPoint, into)
  const [trace, resolve, source, final, bounds] = await Promise.all([
    program(
      createCheckedShaderModule(
        device,
        stochasticReflectionShader(lit, { unbounded: unboundedReflections }),
        'REFLECTION_TRACE',
      ),
      [layout, reflectionLayout(device), reflectionOwnerLayout(device)],
      'traceRoughReflection',
    ),
    program(
      createCheckedShaderModule(device, REFLECTION_RESOLVE_WGSL, 'REFLECTION_HISTORY'),
      resolveLayout,
      'resolveRoughReflection',
      // The mean and its weight, and the moment its clip reads (`resolveWgsl.ts`).
      [...targets, { format: 'r16float' }],
    ),
    program(
      createCheckedShaderModule(device, REFLECTION_SOURCE_WGSL, 'REFLECTION_SOURCE'),
      reflectionSourceLayout(device),
      'reprojectReflectionSource',
    ),
    program(
      createCheckedShaderModule(
        device,
        withReflectionSourceOutput(withScreenReflections(lit, { history: true })),
        'REFLECTION_RESOLVE',
      ),
      [layout, reflectionLayout(device)],
      'lightSurface',
      [...targets, ...targets],
    ),
    // The depth bounds' reductions, once a device, whatever the lighting (`boundsPyramid.ts`).
    reflectionBoundsPipelines(device),
  ])
  return { trace, resolve, resolveLayout, source, final, bounds }
}
