import type { ScreenReflection } from './gpu.ts';
import type { DeferredProgram } from '../lighting/deferred/program.ts';

/** The unfogged image consumed by opaque and forward screen reflections. */
const REFLECTION_SOURCE_PASS = 'Trillion3D reflection source';

/** Encode source then stochastic trace/resolve, borrowing the existing HDR target. */
export function encodeReflectionSource(
  encoder: GPUCommandEncoder,
  target: GPUTextureView,
  reflection: ScreenReflection,
  reflected: NonNullable<DeferredProgram['reflection']>,
  group: GPUBindGroup,
  drawn: readonly number[],
) {
  const source = encoder.beginRenderPass({
    label: REFLECTION_SOURCE_PASS,
    colorAttachments: [
      {
        view: reflection.view,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: [0, 0, 0, 0],
      },
    ],
  });
  source.setViewport(0, 0, drawn[0], drawn[1], 0, 1);
  source.setPipeline(reflected.source);
  source.setBindGroup(0, group);
  source.draw(3);
  source.end();
  reflection.pyramid?.encode(encoder);
  if (reflection.history && !reflection.history.reuse) {
    const trace = encoder.beginRenderPass({
      label: 'Trillion3D rough reflection trace',
      colorAttachments: [
        { view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
    });
    trace.setViewport(0, 0, drawn[0], drawn[1], 0, 1);
    trace.setPipeline(reflected.trace);
    trace.setBindGroup(0, group);
    trace.setBindGroup(1, reflection.group);
    trace.draw(3);
    trace.end();
    reflection.history.encode(encoder, target, reflected.resolve, reflected.resolveLayout);
  }
}
