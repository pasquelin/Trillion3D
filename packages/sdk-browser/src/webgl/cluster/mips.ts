import { createWebglProgram } from '../core/program.ts';
import {
  FULLSCREEN_DISABLED,
  FULLSCREEN_VERTEX,
  setFullscreenPassState,
} from '../core/fullscreenPass.ts';
import { levelSize, mipLevelCountFor } from '../../texture/tiles.ts';

/**
 * The GLSL twin of the WebGPU reduction (`MIP_SHADER`, `../../texture/mips.ts`), line for line:
 * colours averaged — weighted by alpha under `weighted` where the four alphas differ —, alpha the
 * median of the four texels, so threshold coverage survives every level. `source` is a copy of the
 * level above, `extent` its size: the texture drawn into is never the one sampled.
 */
const FRAGMENT = `#version 300 es
precision highp float;
uniform highp sampler2D source;
uniform ivec2 extent;
uniform bool weighted;
out vec4 color;
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy)*2;ivec2 hi=extent-1;
 vec4 s0=texelFetch(source,min(p,hi),0);vec4 s1=texelFetch(source,min(p+ivec2(1,0),hi),0);
 vec4 s2=texelFetch(source,min(p+ivec2(0,1),hi),0);vec4 s3=texelFetch(source,min(p+ivec2(1,1),hi),0);
 vec4 mean=(s0+s1+s2+s3)*0.25;
 float u=min(max(s0.a,s1.a),max(s2.a,s3.a));
 float v=max(min(s0.a,s1.a),min(s2.a,s3.a));
 vec4 a=vec4(s0.a,s1.a,s2.a,s3.a);
 vec3 byAlpha=(s0.rgb*s0.a+s1.rgb*s1.a+s2.rgb*s2.a+s3.rgb*s3.a)/dot(a,vec4(1.0));
 color=vec4(weighted&&any(notEqual(a,vec4(s0.a)))?byAlpha:mean.rgb,(u+v)*0.5);
}`;

/** The capabilities a reduction turns off, restored after it. */
const TOGGLES = [...FULLSCREEN_DISABLED, 'STENCIL_TEST'] as const;

/** A texture as the reducer reads it: its GL name, its format and size. */
type Chain = { texture: WebGLTexture; format: number; width: number; height: number };

/** The reduction's program, its uniforms, its two framebuffers and its empty vertex array. */
function buildReducer(gl: WebGL2RenderingContext) {
  const program = createWebglProgram(gl, FULLSCREEN_VERTEX, FRAGMENT);
  return {
    program,
    source: gl.getUniformLocation(program, 'source'),
    extent: gl.getUniformLocation(program, 'extent'),
    weighted: gl.getUniformLocation(program, 'weighted'),
    draw: gl.createFramebuffer()!,
    read: gl.createFramebuffer()!,
    vertexArray: gl.createVertexArray()!,
  };
}

/**
 * The material mip chain on WebGL2 (#42): one draw per level, in place of `generateMipmap`'s box
 * filter, which averages alpha and darkens the borders of masked foliage. Each level above is
 * first copied (`copyTexSubImage2D`) into a scratch texture the draw samples: a texture is never
 * sampled while one of its levels is the target — a feedback loop a browser may refuse, which
 * left every level at its null allocation, alpha 0, and cut every masked texel (#709). A format
 * whose levels a framebuffer cannot hold (`checkFramebufferStatus`, asked once per format) keeps
 * `generateMipmap`: a box chain, never an empty one. An sRGB texture is read decoded and written
 * encoded: the reduction runs in linear light, as the WebGPU chain's. The state a reduction
 * touches is restored after it, so it may run in the middle of a pass.
 */
export class WebglMipReducer {
  private gl: WebGL2RenderingContext;
  private built: ReturnType<typeof buildReducer> | undefined;
  /** Per format, whether a framebuffer holds its levels. */
  private drawable = new Map<number, boolean>();
  /** The copy of the level above. A chain refilled in place — a live picture — keeps it for the
   *  next picture; a new chain returns it after its reduction, as WebGPU returns its scratches. */
  private scratch: Chain | undefined;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }
  /** Builds levels 1… of `chain.texture`, bound on the active `unit`'s TEXTURE_2D, each from the
   *  one above it, `weighted` or not; `allocate` first gives them storage — a new size, or a
   *  first chain. */
  reduce(unit: number, chain: Chain, weighted: boolean, allocate: boolean) {
    const gl = this.gl,
      { texture, format, width, height } = chain;
    const levels = mipLevelCountFor(width, height);
    if (levels === 1) return;
    if (allocate)
      for (let level = 1; level < levels; level++) {
        const [w, h] = levelSize(width, height, level);
        gl.texImage2D(gl.TEXTURE_2D, level, format, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
    if (this.drawable.get(format) === false) return gl.generateMipmap(gl.TEXTURE_2D);
    const built = (this.built ??= buildReducer(gl));
    const saved = {
      program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
      draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
      read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
      viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
      vertexArray: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
      mask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
      toggles: TOGGLES.map((name) => gl.isEnabled(gl[name])),
    };
    this.scratchFor(chain);
    setFullscreenPassState(gl);
    gl.disable(gl.STENCIL_TEST);
    gl.useProgram(built.program);
    gl.uniform1i(built.source, unit);
    gl.uniform1i(built.weighted, weighted ? 1 : 0);
    gl.bindVertexArray(built.vertexArray);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, built.read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, built.draw);
    const attach = (target: number, level: number) =>
      gl.framebufferTexture2D(target, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, level);
    let drawn = true;
    for (let level = 1; level < levels && drawn; level++) {
      const [sw, sh] = levelSize(width, height, level - 1),
        [w, h] = levelSize(width, height, level);
      attach(gl.READ_FRAMEBUFFER, level - 1);
      attach(gl.DRAW_FRAMEBUFFER, level);
      drawn = this.drawable.get(format) ?? this.check(format);
      if (!drawn) break;
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, sw, sh);
      gl.uniform2i(built.extent, sw, sh);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (allocate) this.dropScratch();
    if (!drawn) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, saved.read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, saved.draw);
    gl.bindVertexArray(saved.vertexArray);
    gl.useProgram(saved.program);
    gl.viewport(saved.viewport[0], saved.viewport[1], saved.viewport[2], saved.viewport[3]);
    gl.colorMask(saved.mask[0], saved.mask[1], saved.mask[2], saved.mask[3]);
    TOGGLES.forEach((name, i) => saved.toggles[i] && gl.enable(gl[name]));
  }
  /** The scratch at `chain`'s format and size, bound on the active unit. */
  private scratchFor({ format, width, height }: Chain) {
    const gl = this.gl,
      held = this.scratch;
    if (held?.format === format && held.width === width && held.height === height)
      return gl.bindTexture(gl.TEXTURE_2D, held.texture);
    this.dropScratch();
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.scratch = { texture, format, width, height };
  }
  private dropScratch() {
    if (this.scratch) this.gl.deleteTexture(this.scratch.texture);
    this.scratch = undefined;
  }
  /** Whether both framebuffers hold a level of `format`, asked once per format. */
  private check(format: number) {
    const gl = this.gl,
      complete = gl.FRAMEBUFFER_COMPLETE;
    const drawable =
      gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === complete &&
      gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === complete;
    this.drawable.set(format, drawable);
    return drawable;
  }
  dispose() {
    const { gl, built } = this;
    this.dropScratch();
    if (!built) return;
    gl.deleteProgram(built.program);
    gl.deleteFramebuffer(built.draw);
    gl.deleteFramebuffer(built.read);
    gl.deleteVertexArray(built.vertexArray);
    this.built = undefined;
  }
}
