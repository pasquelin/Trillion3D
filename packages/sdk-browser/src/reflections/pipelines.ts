import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { makeFullscreenPipeline } from '../lighting/deferred/fullscreen.ts';
import { reflectionLayout } from './layout.ts';
import { reflectionSource, withScreenReflections } from './screenWgsl.ts';
import { stochasticReflectionShader } from './sampleWgsl.ts';
import { REFLECTION_RESOLVE_WGSL, reflectionResolveLayout } from './resolveWgsl.ts';

/** Frozen source and final resolve are separate programs: no uniform can change between
 * two encoded passes through queue.writeBuffer before their shared submission. */
export async function reflectionPipelines(
  device: GPUDevice,
  shader: string,
  layout: GPUBindGroupLayout,
) {
  const source = await createCheckedShaderModule(
    device,
    reflectionSource(shader),
    'REFLECTION_SOURCE',
  );
  const final = await createCheckedShaderModule(
    device,
    withScreenReflections(shader, true),
    'REFLECTION_RESOLVE',
  );
  const targets: GPUColorTargetState[] = [{ format: 'rgba16float' }];
  const trace = await createCheckedShaderModule(
    device,
    stochasticReflectionShader(shader),
    'REFLECTION_TRACE',
  );
  const resolve = await createCheckedShaderModule(
    device,
    REFLECTION_RESOLVE_WGSL,
    'REFLECTION_HISTORY',
  );
  const resolveLayout = reflectionResolveLayout(device);
  return {
    trace: await makeFullscreenPipeline(
      device,
      trace,
      [layout, reflectionLayout(device)],
      'traceRoughReflection',
      targets,
    ),
    resolve: await makeFullscreenPipeline(
      device,
      resolve,
      resolveLayout,
      'resolveRoughReflection',
      targets,
    ),
    resolveLayout,
    source: await makeFullscreenPipeline(device, source, layout, 'lightSurface', targets),
    final: await makeFullscreenPipeline(
      device,
      final,
      [layout, reflectionLayout(device)],
      'lightSurface',
      targets,
    ),
  };
}
