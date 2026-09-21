/**
 * An engine-owned render target: one colour texture and one depth renderbuffer on a framebuffer
 * of the host context, sized in drawing-buffer pixels. The colour is stored sRGB-encoded when
 * `srgb` is set — the hardware encodes every fragment written there and decodes every texel
 * read back through a sampler, so an engine draws linear into it and reads linear out of it —
 * and raw otherwise. The depth is 24-bit, as the page's own drawing buffer.
 */
export type WebglRenderTarget = ReturnType<typeof createWebglRenderTarget>;

/** Where a host draw lands and how it is encoded: the page's drawing buffer (`framebuffer` null)
 *  takes the display chain — sRGB encoding, tone mapping when the scene is lit —, a render
 *  target stores linear values the hardware encodes. `width` and `height` are the viewport's. */
export type HostDrawOutput = {
  encodeSrgb: boolean;
  toneMapped: boolean;
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
};

export function createWebglRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  options: { srgb?: boolean } = {},
) {
  const srgb = options.srgb === true;
  const texture = gl.createTexture()!,
    depth = gl.createRenderbuffer()!,
    framebuffer = gl.createFramebuffer()!;
  let currentWidth = 0,
    currentHeight = 0;
  const allocate = (nextWidth: number, nextHeight: number) => {
    currentWidth = nextWidth;
    currentHeight = nextHeight;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8,
      nextWidth,
      nextHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, nextWidth, nextHeight);
  };
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  allocate(width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`RENDER_TARGET_INCOMPLETE:${status}`);
  return {
    framebuffer,
    texture,
    srgb,
    get width() {
      return currentWidth;
    },
    get height() {
      return currentHeight;
    },
    /** Reallocates the storage at another size; nothing happens at the current one. */
    resize(nextWidth: number, nextHeight: number) {
      if (nextWidth === currentWidth && nextHeight === currentHeight) return false;
      allocate(nextWidth, nextHeight);
      return true;
    },
    dispose() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteRenderbuffer(depth);
      gl.deleteTexture(texture);
    },
  };
}

/** Binds a target — or the page's drawing buffer — and sets the viewport to its whole size. */
export function bindWebglTarget(gl: WebGL2RenderingContext, target: WebglRenderTarget | null) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
  gl.viewport(
    0,
    0,
    target?.width ?? gl.drawingBufferWidth,
    target?.height ?? gl.drawingBufferHeight,
  );
}
