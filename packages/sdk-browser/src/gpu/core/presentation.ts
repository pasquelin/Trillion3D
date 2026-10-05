import { sharedGpuDevice } from './sessionHandle.ts';
import { PRESENT_SHADER } from './presentWgsl.ts';
import { preparedPipeline, started } from '../../lighting/deferred/fullscreen.ts';
import { createCanvasBlit } from '../../webgl/core/canvasBlit.ts';
import { createPresentAt, type PresentRect } from './presentAt.ts';
import { canvasImageKept, canvasImageReplaced, closeCanvasImage } from './canvasHandover.ts';
/** Source is already display encoded. No second tone map or color conversion. A canvas that keeps
 *  its image across sessions (`canvasHandover.ts`) is configured at the first present only.
 *
 *  The canvas keeps the image last presented into it: WebGPU replaces its drawing buffer only when
 *  a new texture is taken (`getCurrentTexture`), when it is configured or when it is sized. So the
 *  presenter knows which display image, at which size, the canvas holds (`holds`), and a held frame
 *  that would copy that same image again encodes nothing. */
export function createGpuPresenter(device: GPUDevice, canvas: HTMLCanvasElement) {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('WEBGPU_CANVAS_UNAVAILABLE');
  const format: GPUTextureFormat = 'bgra8unorm';
  let configured = false,
    // The image the whole canvas holds, at its size: nothing once anything else may have reached it.
    heldImage: GPUTexture | undefined,
    heldWidth = 0,
    heldHeight = 0;
  const forget = () => void (heldImage = undefined);
  const configure = () => {
    if (configured) return;
    // Configuring blanks the canvas: the image of a closed session stays until this one draws.
    canvasImageReplaced(canvas);
    // The canvas takes the device itself: WebGPU refuses a session's handle, no `GPUDevice`.
    context.configure({
      device: sharedGpuDevice(device),
      format,
      alphaMode: 'opaque',
      colorSpace: 'srgb',
    });
    configured = true;
  };
  if (!canvasImageKept(canvas)) configure();
  try {
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
      ],
    });
    const module = device.createShaderModule({ code: PRESENT_SHADER });
    const pipeline = started(
      preparedPipeline(device, {
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'fullscreen' },
        fragment: { module, entryPoint: 'present', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      }),
    );
    let texture: GPUTexture | undefined,
      group: GPUBindGroup | undefined,
      // The canvas texture the whole image was last drawn into: a view is placed on it alone.
      shown: GPUTexture | undefined;
    const presentAt = createPresentAt(device, layout, format);
    /** The whole canvas's texture this frame, blank until a composition fills it (`composed`). */
    const targetView = (width: number, height: number) => {
      configure();
      forget();
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      shown = context.getCurrentTexture();
      return shown.createView();
    };
    /** `image`, `width` × `height`, was just drawn over the whole canvas: the canvas holds it. */
    const composed = (image: GPUTexture, width: number, height: number) => {
      heldImage = image;
      heldWidth = width;
      heldHeight = height;
    };
    return {
      canvas,
      targetView,
      composed,
      /** Whether the canvas still shows `image` whole, at `width` × `height` and at that size. */
      holds: (image: GPUTexture, width: number, height: number) =>
        heldImage === image &&
        heldWidth === width &&
        heldHeight === height &&
        canvas.width === width &&
        canvas.height === height,
      /** What the canvas shows is no longer known: sized by its owner, or a frame was drawn. */
      forget,
      /** Compiles off the frame what presents a view placed at a rectangle of the canvas: asked
       *  when the first one is added, before it presents. */
      preparePlaced: presentAt.prepare,
      /** The image over the whole canvas, sized to it; at `at`, a persistent view's rectangle of
       *  the canvas, which keeps its size and what else it shows this frame. */
      present(
        encoder: GPUCommandEncoder,
        image: GPUTexture,
        width: number,
        height: number,
        at?: PresentRect,
      ) {
        if (at) {
          // Not this frame's whole image (its targets still asked, say): the canvas keeps the
          // last frame it showed, never a blank one with this view alone on it. Either way the
          // canvas no longer holds one image whole.
          forget();
          if (!configured) return;
          const current = context.getCurrentTexture();
          if (current === shown)
            presentAt.present(encoder, current.createView(), image, at, canvas);
          return;
        }
        const view = targetView(width, height);
        if (texture !== image) {
          texture = image;
          group = device.createBindGroup({
            layout,
            entries: [{ binding: 0, resource: image.createView() }],
          });
        }
        const pass = encoder.beginRenderPass({
          label: 'Trillion3D direct present',
          colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        });
        pass.setPipeline(pipeline.get());
        pass.setBindGroup(0, group!);
        pass.draw(3);
        pass.end();
        composed(image, width, height);
      },
      /** Withdraws the image: nothing that samples the canvas afterwards reads a frame of this
       *  device — at once, or once no session follows on a kept canvas (`closeCanvasImage`). */
      dispose() {
        group = undefined;
        texture = shown = undefined;
        forget();
        if (!configured) return;
        closeCanvasImage(canvas, () => {
          context.unconfigure();
          // Unconfiguring replaces the drawing buffer with transparent black, but a reader that
          // samples the canvas (`texImage2D`) still sees the last image in Chromium: resetting
          // the bitmap the HTML way — a size write — makes the withdrawal hold for every reader.
          const { width } = canvas;
          canvas.width = width;
        });
      },
    };
  } catch (error) {
    if (configured) context.unconfigure();
    throw error;
  }
}

/** Row pitch of a readback buffer: RGBA8 rows padded to WebGPU's 256-byte alignment. */
export const readbackBytesPerRow = (width: number) => Math.ceil((width * 4) / 256) * 256;

/** Explicit diagnostic capture only. Copies WebGPU top-left rows to the SDK's bottom-left convention. */
export async function readGpuImage(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const bytesPerRow = readbackBytesPerRow(width);
  const buffer = device.createBuffer({
    label: 'Trillion3D explicit capture',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    signal?.throwIfAborted();
    const mapped = new Uint8Array(buffer.getMappedRange()),
      pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      pixels.set(
        mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4),
        (height - 1 - y) * width * 4,
      );
    buffer.unmap();
    return pixels;
  } finally {
    buffer.destroy();
  }
}

/** Compatibility for hosts with a synchronous capture API. This isolated WebGL
 * readback is created only on explicit capture(), never by the beauty loop. */
export function createSynchronousCanvasCapture() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('SYNCHRONOUS_CAPTURE_UNAVAILABLE: await flush before capture');
  let blit: ReturnType<typeof createCanvasBlit>;
  try {
    blit = createCanvasBlit(gl);
  } catch (error) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    throw error;
  }
  return {
    read(source: HTMLCanvasElement) {
      if (gl.isContextLost()) throw new Error('CAPTURE_CONTEXT_LOST');
      if (canvas.width !== source.width) canvas.width = source.width;
      if (canvas.height !== source.height) canvas.height = source.height;
      gl.viewport(0, 0, canvas.width, canvas.height);
      // The copy reverses the rows: the read that follows starts at the bottom, which is the
      // convention the SDK publishes.
      blit.draw(source);
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`CAPTURE_WEBGL_ERROR: ${error}`);
      return pixels;
    },
    dispose() {
      blit.dispose();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
