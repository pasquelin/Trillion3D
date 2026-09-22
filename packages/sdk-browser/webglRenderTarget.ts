import type { SceneToneMapping } from '../sdk-core/sceneEnvironment.ts';
/**
 * An engine-owned render target: one colour texture and, unless declined, one 24-bit depth
 * renderbuffer on a framebuffer of the host context, sized in drawing-buffer pixels. It holds a
 * display image — the bytes the page would show, sRGB-encoded and tone-mapped by the engine that
 * drew it, stored as written — so that a side of a comparison is the single view of that engine,
 * byte for byte, and no value is clamped or requantised on the way.
 */
export type WebglRenderTarget = ReturnType<typeof createWebglRenderTarget>;

/** Where a host draw lands — the page's drawing buffer for a `null` framebuffer — and whether
 *  the scene's light calls for tone mapping; `width` and `height` are the viewport's. */
export type HostDrawOutput = {
  toneMapped: boolean;
  /** The display curve the scene chose; ACES when absent. */
  toneMapping?: SceneToneMapping;
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
};

export function createWebglRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  options: { depth?: boolean } = {},
) {
  const texture = gl.createTexture()!,
    depth = options.depth === false ? null : gl.createRenderbuffer()!,
    framebuffer = gl.createFramebuffer()!;
  let currentWidth = 0,
    currentHeight = 0;
  // The texture is allocated on unit 0 and unbound after: left on a unit a program samples,
  // it would make every draw into this target a feedback loop the browser refuses.
  const allocate = (nextWidth: number, nextHeight: number) => {
    currentWidth = nextWidth;
    currentHeight = nextHeight;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      nextWidth,
      nextHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (depth) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, nextWidth, nextHeight);
    }
  };
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  allocate(width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (depth)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`RENDER_TARGET_INCOMPLETE:${status}`);
  return {
    framebuffer,
    texture,
    get width() {
      return currentWidth;
    },
    get height() {
      return currentHeight;
    },
    resize(nextWidth: number, nextHeight: number) {
      if (nextWidth === currentWidth && nextHeight === currentHeight) return false;
      allocate(nextWidth, nextHeight);
      return true;
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      if (depth) gl.deleteRenderbuffer(depth);
      gl.deleteTexture(texture);
    },
  };
}

/** Binds a target — or the page's drawing buffer — and sets the viewport to its whole size,
 *  which it returns. */
export function bindWebglTarget(gl: WebGL2RenderingContext, target: WebglRenderTarget | null) {
  const width = target?.width ?? gl.drawingBufferWidth,
    height = target?.height ?? gl.drawingBufferHeight;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
  gl.viewport(0, 0, width, height);
  return { width, height };
}
