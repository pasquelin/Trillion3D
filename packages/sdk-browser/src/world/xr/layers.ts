import { uploadXrGlLayer } from './glLayerUpload.ts';
import type { XrFrame, XrSession, XrSpace } from './platform.ts';

export type XrLayerKind = 'quad' | 'equirect';
export type XrLayerImage = HTMLCanvasElement | OffscreenCanvas | ImageBitmap | HTMLVideoElement;
export interface XrLayerOptions {
  space: XrSpace;
  width?: number;
  height?: number;
  radius?: number;
  centralHorizontalAngle?: number;
  upperVerticalAngle?: number;
  lowerVerticalAngle?: number;
  viewPixelWidth: number;
  viewPixelHeight: number;
}
export interface XrLayer {
  needsRedraw?: boolean;
  destroy?(): void;
}
export interface XrLayerBinding {
  createQuadLayer?(options: Record<string, unknown>): XrLayer;
  createEquirectLayer?(options: Record<string, unknown>): XrLayer;
  getSubImage?(
    layer: XrLayer,
    frame: XrFrame,
  ): {
    colorTexture: GPUTexture | WebGLTexture;
    viewport: { x: number; y: number; width: number; height: number };
  };
}
export interface XrLayerHandle {
  update(image: XrLayerImage): void;
  dispose(): void;
}

/** Static mono composition layers are uploaded only after update() or a compositor redraw. */
export function createXrLayers(
  session: XrSession,
  projection: XrLayer,
  binding: XrLayerBinding,
  device?: GPUDevice,
  gl?: WebGL2RenderingContext,
) {
  const layers = new Map<
    XrLayer,
    {
      image?: XrLayerImage;
      dirty: boolean;
      width: number;
      height: number;
      frame?: XrFrame;
      rebuild(): void;
    }
  >();
  const retired = new Map<XrLayer, XrFrame | undefined>();
  let currentFrame: XrFrame | undefined;
  let disposed = false;
  const publish = () => session.updateRenderState({ layers: [projection, ...layers.keys()] });
  return {
    create(kind: XrLayerKind, options: XrLayerOptions): XrLayerHandle {
      if (disposed) throw new Error('XR_SESSION_ENDED');
      options = { ...options };
      const create = kind === 'quad' ? binding.createQuadLayer : binding.createEquirectLayer;
      if (!create || !binding.getSubImage) throw new Error('XR_LAYERS_UNAVAILABLE');
      if (
        ![options.viewPixelWidth, options.viewPixelHeight].every(
          (n) => Number.isInteger(n) && n > 0,
        )
      )
        throw new Error('XR_LAYER_SIZE_INVALID');
      const make = () =>
        create.call(binding, {
          ...options,
          layout: 'mono',
          isStatic: true,
          ...(device
            ? {
                colorFormat: 'rgba8unorm',
                textureUsage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
              }
            : { colorFormat: gl!.RGBA }),
        });
      let layer = make();
      const entry = {
        rebuild() {
          const next = make(),
            previous = layer;
          const saved = [...layers];
          const ordered = saved.map(
            ([key, value]) => [key === previous ? next : key, value] as const,
          );
          layers.clear();
          for (const [key, value] of ordered) layers.set(key, value);
          layer = next;
          try {
            publish();
          } catch (error) {
            layers.clear();
            for (const [key, value] of saved) layers.set(key, value);
            layer = previous;
            next.destroy?.();
            throw error;
          }
          retired.set(previous, currentFrame);
        },
        frame: undefined as XrFrame | undefined,
        dirty: true,
        width: options.viewPixelWidth,
        height: options.viewPixelHeight,
        image: undefined as XrLayerImage | undefined,
      };
      layers.set(layer, entry);
      try {
        publish();
      } catch (error) {
        layers.delete(layer);
        layer.destroy?.();
        throw error;
      }
      return {
        update(image) {
          if (!layers.has(layer)) throw new Error('XR_LAYER_RELEASED');
          entry.image = image;
          entry.dirty = true;
        },
        dispose() {
          const saved = [...layers];
          if (!layers.delete(layer)) return;
          try {
            if (!disposed) publish();
          } catch (error) {
            layers.clear();
            for (const [key, value] of saved) layers.set(key, value);
            throw error;
          }
          retired.set(layer, currentFrame);
        },
      };
    },
    frame(frame: XrFrame) {
      currentFrame = frame;
      for (const [layer, lastFrame] of retired)
        if (lastFrame !== frame) {
          layer.destroy?.();
          retired.delete(layer);
        }
      for (const [layer, entry] of layers) {
        if (entry.frame === frame) continue;
        if (!entry.image || (!entry.dirty && !layer.needsRedraw)) continue;
        if (entry.dirty && layer.needsRedraw === false) {
          entry.frame = frame;
          entry.rebuild();
          continue;
        }
        const sub = binding.getSubImage!(layer, frame),
          rect = sub.viewport;
        if (rect.width !== entry.width || rect.height !== entry.height)
          throw new Error('XR_LAYER_SIZE_CHANGED');
        if (device)
          device.queue.copyExternalImageToTexture(
            { source: entry.image },
            {
              texture: sub.colorTexture as GPUTexture,
              origin: { x: rect.x, y: rect.y },
              premultipliedAlpha: true,
            },
            { width: rect.width, height: rect.height },
          );
        else uploadXrGlLayer(gl!, sub.colorTexture as WebGLTexture, entry.image, rect);
        entry.dirty = false;
      }
    },
    dispose() {
      disposed = true;
      for (const layer of layers.keys()) layer.destroy?.();
      layers.clear();
      for (const layer of retired.keys()) layer.destroy?.();
      retired.clear();
    },
  };
}
