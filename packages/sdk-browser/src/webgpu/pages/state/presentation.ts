import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Main starts the canvas image, including a held rectangular view; later views preserve it. */
export function presentDrawnView(
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'views'>,
  encoder: GPUCommandEncoder,
) {
  const { gpu, views } = rt;
  gpu.presenter!.present(
    encoder,
    gpu.displayTexture!,
    ...gpu.displaySize,
    views.active.rect,
    views.active === views.main,
  );
}
