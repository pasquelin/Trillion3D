import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';
import { makeFullscreenPipeline } from '../lighting/deferred/fullscreen.ts';
import { reflectionLayout } from './gpu.ts';
import { reflectionSource, withScreenReflections } from './screenWgsl.ts';

/** Frozen source and final resolve are separate programs: no uniform can change between
 * two encoded passes through queue.writeBuffer before their shared submission. */
export async function reflectionPipelines(
  device: GPUDevice,
  shader: string,
  layout: GPUBindGroupLayout,
  bounce: boolean,
) {
  const source = await createCheckedShaderModule(
    device,
    reflectionSource(shader),
    'REFLECTION_SOURCE',
  );
  const final = await createCheckedShaderModule(
    device,
    withScreenReflections(shader, !bounce),
    'REFLECTION_RESOLVE',
  );
  const targets: GPUColorTargetState[] = [{ format: 'rgba16float' }];
  return {
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
