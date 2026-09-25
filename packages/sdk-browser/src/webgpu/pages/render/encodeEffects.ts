import { createWebgpuEffects } from '../../../effects/webgpuEffects.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { AccumulatedImage, ComposedImage } from '../../../lighting/deferred/program.ts';

/** What composition reads of the chain's output, rewritten at each image: nothing allocated. */
const chained: ComposedImage = { color: undefined as unknown as GPUTextureView };

/**
 * The world's effect chain on this image (`../../../effects/webgpuEffects.ts`): the passes that
 * run before tone mapping, over the resolved linear image — `accumulated`, or the lit image when
 * the image does not accumulate —; returns what composition reads, `accumulated` itself when the
 * chain draws nothing. The chain's output keeps the as-is share of the image it read. A diagnostic
 * view and a surface capture show the engine's image as it is, without the chain. The revision
 * drawn is kept, none after a capture, so a change of the chain breaks the hold
 * (`../../frame/hold.ts`).
 */
export function encodeEffects(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  accumulated: AccumulatedImage | undefined,
): ComposedImage | undefined {
  const chain = rt.context.effects,
    { gpu, run } = rt;
  if (!chain) return accumulated;
  const passes = chain.stage('before-tone-mapping');
  // A diagnostic view or a capture draws without the chain, which keeps its targets meanwhile. The
  // main view a capture restores is drawn so too (`../io/surfaceRestore.ts`): it lacks the chain.
  const captured = passes.length > 0 && rt.capture.capturing;
  gpu.effectsRevision = captured ? -1 : chain.revision;
  if (captured || (passes.length && run.diagnostic !== 'beauty')) return accumulated;
  const input = accumulated?.color ?? gpu.hdrView;
  if ((!passes.length && !gpu.effects) || !input) return accumulated;
  gpu.effects ??= createWebgpuEffects(device, {
    ready: () => run.gate.resourcesChanged(),
    failed: (error) => rt.diag.diagnosticFailure('effects-unavailable', error),
  });
  const [width, height] = gpu.targetSize;
  const output = gpu.effects.encode(encoder, passes, input, width, height);
  run.gpuDrawCalls += gpu.effects.draws;
  if (output === input) return accumulated;
  chained.color = output;
  chained.share = accumulated?.share;
  return chained;
}

/** True while the image does not show the chain as it stands: changed since the last image, or
 *  its programs still compiling. */
export function effectsUnsettled(rt: WebgpuPagesRuntime) {
  const chain = rt.context.effects;
  return !!chain && (chain.revision !== rt.gpu.effectsRevision || !!rt.gpu.effects?.loading);
}
