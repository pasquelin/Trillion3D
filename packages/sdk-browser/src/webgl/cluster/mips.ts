import { createWebglProgram } from '../core/program.ts';
import {
  FULLSCREEN_DISABLED,
  FULLSCREEN_VERTEX,
  setFullscreenPassState,
} from '../core/fullscreenPass.ts';
import { levelSize, mipLevelCountFor } from '../../texture/tiles.ts';

/** The GLSL twin of the WebGPU reduction (`MIP_SHADER`, `../../texture/mips.ts`), line for line;
 *  `source` is a copy of the level above, `extent` its size. */
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
 float u=min(max(s0.a,s1.a),max(s2.a,s3.a));float v=max(min(s0.a,s1.a),min(s2.a,s3.a));
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
 * WebGL2 material mips (#42), not `generateMipmap`'s box: one draw per level from a scratch copy of
 * the level above — #709 sampled the texture it drew into, a loop the browser refused, and left
 * every level empty (alpha 0). A format no framebuffer holds (asked once) keeps the box chain.
 * sRGB is read decoded, written encoded; the state touched is restored, so it runs mid-pass.
 */
export class WebglMipReducer {
  private gl: WebGL2RenderingContext;
  private built: ReturnType<typeof buildReducer> | undefined;
  /** Per format, whether a framebuffer holds its levels. */
  private drawable = new Map<number, boolean>();
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }
  /** Builds levels 1… of `chain.texture`, bound on the active `unit`'s TEXTURE_2D, each from the
   *  one above, `weighted` or not; `allocate` first gives them storage (a new size or chain). */
  reduce(unit: number, chain: Chain, weighted: boolean, allocate: boolean) {
    const gl = this.gl,
      { texture, format, width, height } = chain;
    const levels = mipLevelCountFor(width, height);
    if (levels === 1) return;
    const store = (level: number, [w, h]: [number, number]) =>
      gl.texImage2D(gl.TEXTURE_2D, level, format, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (let level = 1; allocate && level < levels; level++)
      store(level, levelSize(width, height, level));
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
    const scratch = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, scratch);
    store(0, [width, height]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    setFullscreenPassState(gl);
    gl.disable(gl.STENCIL_TEST);
    gl.useProgram(built.program);
    gl.uniform1i(built.source, unit);
    gl.uniform1i(built.weighted, weighted ? 1 : 0);
    gl.bindVertexArray(built.vertexArray);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, built.read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, built.draw);
    const attach = (target: number, level: number, image: WebGLTexture | null = texture) =>
      gl.framebufferTexture2D(target, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, level);
    let drawn = true;
    for (let level = 1; level < levels; level++) {
      const [sw, sh] = levelSize(width, height, level - 1),
        [w, h] = levelSize(width, height, level);
      attach(gl.READ_FRAMEBUFFER, level - 1);
      attach(gl.DRAW_FRAMEBUFFER, level);
      if (!(drawn = this.drawable.get(format) ?? this.check(format))) break; // checked at level 1
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, sw, sh);
      gl.uniform2i(built.extent, sw, sh);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    attach(gl.READ_FRAMEBUFFER, 0, null);
    attach(gl.DRAW_FRAMEBUFFER, 0, null);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.deleteTexture(scratch);
    if (!drawn) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, saved.read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, saved.draw);
    gl.bindVertexArray(saved.vertexArray);
    gl.useProgram(saved.program);
    gl.viewport(saved.viewport[0], saved.viewport[1], saved.viewport[2], saved.viewport[3]);
    gl.colorMask(saved.mask[0], saved.mask[1], saved.mask[2], saved.mask[3]);
    TOGGLES.forEach((name, i) => saved.toggles[i] && gl.enable(gl[name]));
  }
  /** Whether both framebuffers hold a level of `format`, asked once per format. */
  private check(format: number) {
    const gl = this.gl,
      complete = (target: number) => gl.checkFramebufferStatus(target) === gl.FRAMEBUFFER_COMPLETE;
    const drawable = complete(gl.DRAW_FRAMEBUFFER) && complete(gl.READ_FRAMEBUFFER);
    this.drawable.set(format, drawable);
    return drawable;
  }
  dispose() {
    const { gl, built } = this;
    if (!built) return;
    gl.deleteProgram(built.program);
    gl.deleteFramebuffer(built.draw);
    gl.deleteFramebuffer(built.read);
    gl.deleteVertexArray(built.vertexArray);
    this.built = undefined;
  }
}
