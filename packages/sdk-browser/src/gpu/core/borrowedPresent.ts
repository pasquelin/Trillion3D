import { createPresentAt, type PresentRect } from './presentAt.ts';

/** A browser-owned XR texture, valid only during its frame; never destroyed by the renderer. */
export interface BorrowedPresent {
  texture: GPUTexture;
  view: GPUTextureView;
  format: GPUTextureFormat;
  viewport: PresentRect;
}
export function createBorrowedPresent(device: GPUDevice, layout: GPUBindGroupLayout) {
  const programs = new Map<GPUTextureFormat, ReturnType<typeof createPresentAt>>();
  let target: BorrowedPresent | undefined;
  return {
    set(value?: BorrowedPresent) {
      target = value;
    },
    present(encoder: GPUCommandEncoder, image: GPUTexture) {
      if (!target) return false;
      let draw = programs.get(target.format);
      if (!draw)
        programs.set(target.format, (draw = createPresentAt(device, layout, target.format)));
      draw(encoder, target.view, image, target.viewport, target.texture);
      return true;
    },
  };
}
