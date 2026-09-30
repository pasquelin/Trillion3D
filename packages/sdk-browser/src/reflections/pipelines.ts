import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { makeFullscreenPipeline } from '../lighting/deferred/fullscreen.ts';
import { reflectionLayout } from './layout.ts';
import { withScreenReflections } from './screenWgsl.ts';
import { withReflectionSourceOutput } from './sourceOutputWgsl.ts';
import { REFLECTION_SOURCE_WGSL, reflectionSourceLayout } from './sourceWgsl.ts';
import { stochasticReflectionShader } from './sampleWgsl.ts';
import { REFLECTION_RESOLVE_WGSL, reflectionResolveLayout } from './resolveWgsl.ts';

/** The source reprojects the last image's unfogged colour, which the final pass writes as its second
 * target (`sourceOutputWgsl.ts`): no pass here lights a surface but the final one. Source and final resolve are separate programs: no uniform can change between
 * two encoded passes through queue.writeBuffer before their shared submission. The four compile
 * together, off the thread (#1362): the lit program the first image waits for is its slowest one,
 * never their sum. */
export async function reflectionPipelines(
  device: GPUDevice,
  shader: string,
  layout: GPUBindGroupLayout,
) {
  const targets: GPUColorTargetState[] = [{ format: 'rgba16float' }];
  const resolveLayout = reflectionResolveLayout(device);
  // Each module is checked where its text is named: the shader sweep reads the call
  // (`engineShaders.test.ts`).
  const program = async (
    module: Promise<GPUShaderModule>,
    bind: GPUBindGroupLayout | readonly GPUBindGroupLayout[],
    entryPoint: string,
    into = targets,
  ) => makeFullscreenPipeline(device, await module, bind, entryPoint, into);
  const [trace, resolve, source, final] = await Promise.all([
    program(
      createCheckedShaderModule(device, stochasticReflectionShader(shader), 'REFLECTION_TRACE'),
      [layout, reflectionLayout(device)],
      'traceRoughReflection',
    ),
    program(
      createCheckedShaderModule(device, REFLECTION_RESOLVE_WGSL, 'REFLECTION_HISTORY'),
      resolveLayout,
      'resolveRoughReflection',
    ),
    program(
      createCheckedShaderModule(device, REFLECTION_SOURCE_WGSL, 'REFLECTION_SOURCE'),
      reflectionSourceLayout(device),
      'reprojectReflectionSource',
    ),
    program(
      createCheckedShaderModule(
        device,
        withReflectionSourceOutput(withScreenReflections(shader, true)),
        'REFLECTION_RESOLVE',
      ),
      [layout, reflectionLayout(device)],
      'lightSurface',
      [...targets, ...targets],
    ),
  ]);
  return { trace, resolve, resolveLayout, source, final };
}
