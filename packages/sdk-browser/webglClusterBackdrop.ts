/**
 * Frozen backdrop of the WebGL2 transmission pass: linear colour and depth of everything the
 * owner drew before the transmissive copies — clusters, opaque and blended, over the scene
 * background. The display target holds the display-encoded image, which a transmitted share
 * cannot be composed from; so the same submissions are drawn a second time here, in linear light
 * and without tone mapping, exactly as the reference renderer fills its transmission target.
 * The cost is the second opaque pass, paid only by a frame that carries a transmissive copy.
 */
const BACKDROP_EXTENSIONS = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float'];
/** The host background as `WebglClusterScene` carries it: a colour clears the backdrop. */
type Background = { isColor?: boolean; r?: number; g?: number; b?: number } | object | null;

/** Names the missing capability when the context cannot render a half-float backdrop. */
export function backdropFormatReason(gl: WebGL2RenderingContext) {
  if (BACKDROP_EXTENSIONS.some((name) => gl.getExtension(name))) return;
  return 'transmission needs a half-float backdrop (EXT_color_buffer_half_float)';
}

export class WebglClusterBackdrop {
  private gl: WebGL2RenderingContext;
  private framebuffer: WebGLFramebuffer | null = null;
  private color: WebGLTexture | null = null;
  private depth: WebGLTexture | null = null;
  private width = 0;
  private height = 0;
  private savedFramebuffer: WebGLFramebuffer | null = null;
  private savedViewport = new Int32Array(4);
  private savedScissor = false;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }
  /** Bytes the two copies hold: half-float colour (8) and 24-bit depth (4) per pixel. */
  get bytes() {
    return this.width * this.height * 12;
  }
  /** Viewport origin of the frame being drawn: fragment coordinates minus it are backdrop texels. */
  get originX() {
    return this.savedViewport[0];
  }
  get originY() {
    return this.savedViewport[1];
  }
  private texture(internalFormat: number, width: number, height: number) {
    const gl = this.gl,
      texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
  private resize(width: number, height: number) {
    if (this.framebuffer && this.width === width && this.height === height) return;
    const gl = this.gl;
    this.release();
    const reason = backdropFormatReason(gl);
    if (reason) throw new Error(`Unsupported autonomous transmission: ${reason}`);
    this.color = this.texture(gl.RGBA16F, width, height);
    this.depth = this.texture(gl.DEPTH_COMPONENT24, width, height);
    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0);
    this.width = width;
    this.height = height;
  }
  /**
   * Binds the backdrop, sized to the current viewport and cleared to the linear background
   * colour (black for any other background), remembering the frame's own target, viewport and
   * scissor. Draw, then `end()`.
   */
  begin(background: Background | undefined, colorUnit: number, depthUnit: number) {
    const gl = this.gl,
      colour = background as { isColor?: boolean; r: number; g: number; b: number } | null;
    this.savedViewport.set(gl.getParameter(gl.VIEWPORT) as Int32Array);
    this.savedFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    this.savedScissor = gl.isEnabled(gl.SCISSOR_TEST);
    const width = Math.max(1, this.savedViewport[2]),
      height = Math.max(1, this.savedViewport[3]);
    // Created on the depth unit, so no material unit is disturbed; then both units are
    // released: the program's samplers still name the two copies, from the previous frame or
    // from their creation, and drawing into a bound texture is a feedback loop the context refuses.
    gl.activeTexture(gl.TEXTURE0 + depthUnit);
    this.resize(width, height);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0 + colorUnit);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, width, height);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    if (colour?.isColor) gl.clearColor(colour.r, colour.g, colour.b, 1);
    else gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
  /** Gives the frame its target back, at the viewport and scissor it had. */
  end() {
    const gl = this.gl,
      viewport = this.savedViewport;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.savedFramebuffer);
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    if (this.savedScissor) gl.enable(gl.SCISSOR_TEST);
    this.savedFramebuffer = null;
  }
  /** Binds the two copies on the units the transmission samplers read. */
  bind(colorUnit: number, depthUnit: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + colorUnit);
    gl.bindTexture(gl.TEXTURE_2D, this.color);
    gl.activeTexture(gl.TEXTURE0 + depthUnit);
    gl.bindTexture(gl.TEXTURE_2D, this.depth);
  }
  private release() {
    const gl = this.gl;
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.color) gl.deleteTexture(this.color);
    if (this.depth) gl.deleteTexture(this.depth);
    this.framebuffer = this.color = this.depth = null;
    this.width = this.height = 0;
  }
  dispose() {
    this.release();
  }
}
