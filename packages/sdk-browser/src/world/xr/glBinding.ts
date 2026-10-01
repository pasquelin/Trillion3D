import type { XrSession, XrView } from './platform.ts';
import type { XrGlLayer, XrProjectionLayer } from './binding.ts';
import { createXrLayers, type XrLayerBinding } from './layers.ts';

interface GlBinding extends XrLayerBinding {
  createProjectionLayer(options: Record<string, unknown>): XrProjectionLayer;
  getViewSubImage(
    layer: XrProjectionLayer,
    view: XrView,
  ): {
    colorTexture: WebGLTexture;
    viewport: { x: number; y: number; width: number; height: number };
  };
}
/** Layers-capable WebGL uses browser textures; older runtimes use the ordinary XRWebGLLayer. */
export async function openXrGlBinding(session: XrSession, gl: WebGL2RenderingContext) {
  const browser = globalThis as unknown as {
    XRWebGLBinding?: new (session: XrSession, gl: WebGL2RenderingContext) => GlBinding;
    XRWebGLLayer?: new (
      session: XrSession,
      gl: WebGL2RenderingContext,
      options: Record<string, unknown>,
    ) => XrGlLayer;
  };
  await (gl as WebGL2RenderingContext & { makeXRCompatible(): Promise<void> }).makeXRCompatible();
  if (browser.XRWebGLBinding && session.enabledFeatures?.includes('layers')) {
    const binding = new browser.XRWebGLBinding(session, gl);
    const layer = binding.createProjectionLayer({
      textureType: 'texture',
      scaleFactor: 1,
      depthFormat: 0,
    });
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      layer.destroy?.();
      throw new Error('XR_FRAMEBUFFER_UNAVAILABLE');
    }
    try {
      session.updateRenderState({ layers: [layer] });
    } catch (error) {
      gl.deleteFramebuffer(framebuffer);
      layer.destroy?.();
      throw error;
    }
    const layers = createXrLayers(session, layer, binding, undefined, gl);
    return {
      layer,
      layers,
      gpu: undefined,
      gl: {
        framebuffer,
        getViewport(view: XrView) {
          const image = binding.getViewSubImage(layer, view);
          const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          try {
            gl.framebufferTexture2D(
              gl.FRAMEBUFFER,
              gl.COLOR_ATTACHMENT0,
              gl.TEXTURE_2D,
              image.colorTexture,
              0,
            );
          } finally {
            gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
          }
          return image.viewport;
        },
      },
      endFrame() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      },
      dispose() {
        layers.dispose();
        gl.deleteFramebuffer(framebuffer);
        layer.destroy?.();
      },
    };
  }
  if (!browser.XRWebGLLayer) throw new Error('XR_BINDING_UNAVAILABLE');
  const layer = new browser.XRWebGLLayer(session, gl, {
    alpha: true,
    antialias: false,
    ignoreDepthValues: true,
    framebufferScaleFactor: 1,
  });
  session.updateRenderState({ baseLayer: layer });
  return { layer, layers: undefined, gpu: undefined, gl: layer, dispose: () => layer.destroy?.() };
}
