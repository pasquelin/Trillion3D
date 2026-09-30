import type { ScreenReflection } from './gpu.ts';
import type { DeferredProgram } from '../lighting/deferred/program.ts';
import { REFLECTION_SOURCE_PASS } from './sourcePass.ts';

/**
 * Encode the source, then the rough trace and its resolve, borrowing the HDR target. The source is
 * the last image's unfogged colour, which its lighting wrote as a second target: no lighting runs
 * twice. The trace draws one ray per 2 × 2 block, in the target's top-left quarter
 * (`sampleWgsl.ts`). The depth and identifiers both reprojections read are then this image's.
 */
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
  const reprojected = reflection.sourceGroup;
  // Without its inputs yet, the cleared source answers no ray: every one reads the fallback.
  if (reprojected) {
    source.setViewport(0, 0, drawn[0], drawn[1], 0, 1);
    source.setPipeline(reflected.source);
    source.setBindGroup(0, reprojected);
    source.draw(3);
  }
  source.end();
  const traced = !!reflection.history && !reflection.history.reuse;
  // Without radiance levels only the trace reads the depth bounds: an image it skips skips them.
  if (reflection.pyramid?.radiance || traced) reflection.pyramid?.encode(encoder);
  if (traced && reflection.history) {
    const trace = encoder.beginRenderPass({
      label: 'Trillion3D rough reflection trace',
      colorAttachments: [
        { view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
      ],
    });
    trace.setViewport(0, 0, Math.ceil(drawn[0] / 2), Math.ceil(drawn[1] / 2), 0, 1);
    trace.setPipeline(reflected.trace);
    trace.setBindGroup(0, group);
    trace.setBindGroup(1, reflection.group);
    trace.draw(3);
    trace.end();
    reflection.history.encode(encoder, target, reflected.resolve, reflected.resolveLayout);
  }
  reflection.keepSource(encoder);
}
