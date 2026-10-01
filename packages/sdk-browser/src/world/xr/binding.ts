import { openXrGlBinding } from './glBinding.ts';
import { createXrLayers, type XrLayerBinding } from './layers.ts';
import type { BorrowedPresent } from '../../gpu/core/borrowedPresent.ts';
import { sharedGpuDevice } from '../../gpu/core/sessionHandle.ts';
import type { XrSession, XrView } from './platform.ts';
import type { PresentRect } from '../../gpu/core/presentAt.ts';

export interface XrProjectionLayer {
  destroy?(): void;
}
interface XrGpuBinding extends XrLayerBinding {
  getPreferredColorFormat?(): GPUTextureFormat;
  createProjectionLayer(options: {
    colorFormat: GPUTextureFormat;
    depthStencilFormat?: GPUTextureFormat;
    scaleFactor: number;
  }): XrProjectionLayer;
  getViewSubImage(
    layer: XrProjectionLayer,
    view: XrView,
  ): {
    colorTexture: GPUTexture;
    viewport: PresentRect;
    imageIndex?: number;
    getViewDescriptor?(): GPUTextureViewDescriptor;
  };
}
export interface XrGlLayer extends XrProjectionLayer {
  framebuffer: WebGLFramebuffer;
  framebufferWidth: number;
  framebufferHeight: number;
  getViewport(view: XrView): PresentRect;
}
export async function openXrBinding(
  session: XrSession,
  device?: GPUDevice,
  gl?: WebGL2RenderingContext,
) {
  const browser = globalThis as unknown as {
    XRGPUBinding?: new (session: XrSession, device: GPUDevice) => XrGpuBinding;
    XRWebGLLayer?: new (
      session: XrSession,
      gl: WebGL2RenderingContext,
      options: { alpha: boolean; antialias: boolean; framebufferScaleFactor: number },
    ) => XrGlLayer;
  };
  if (device) {
    if (!browser.XRGPUBinding)
      throw new Error(
        'XR_WEBGPU_UNAVAILABLE: create the world with renderer: webgl2 on this browser',
      );
    const binding = new browser.XRGPUBinding(session, sharedGpuDevice(device));
    const format = binding.getPreferredColorFormat?.() ?? 'rgba8unorm';
    const layer = binding.createProjectionLayer({ colorFormat: format, scaleFactor: 1 });
    try {
      session.updateRenderState({ layers: [layer] });
    } catch (error) {
      layer.destroy?.();
      throw error;
    }
    const layers = createXrLayers(session, layer, binding, sharedGpuDevice(device));
    return {
      layer,
      layers,
      gpu(view: XrView): BorrowedPresent {
        const image = binding.getViewSubImage(layer, view),
          texture = image.colorTexture;
        const descriptor: GPUTextureViewDescriptor = image.getViewDescriptor?.() ?? {
          dimension: '2d',
          baseArrayLayer: image.imageIndex ?? 0,
          arrayLayerCount: 1,
        };
        return { texture, view: texture.createView(descriptor), format, viewport: image.viewport };
      },
      gl: undefined,
      dispose: () => {
        layers.dispose();
        layer.destroy?.();
      },
    };
  }
  if (!gl) throw new Error('XR_BINDING_UNAVAILABLE');
  return openXrGlBinding(session, gl);
}
