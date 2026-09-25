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
 * median of the four texels, so threshold coverage survives every level. The source is the one
 * level the texture's base and max levels leave readable: `texelFetch` and `textureSize` read
 * relative to the base level, and the level drawn is outside that range — no feedback loop.
 */
const FRAGMENT = `#version 300 es
precision highp float;
uniform highp sampler2D source;
uniform bool weighted;
out vec4 color;
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy)*2;ivec2 hi=textureSize(source,0)-1;
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

/**
 * The material mip chain on WebGL2 (#42): one draw per level into a framebuffer on that level, in
 * place of `generateMipmap`'s box filter, which averages alpha and darkens the borders of masked
 * foliage. An sRGB texture is read decoded and written encoded: the reduction runs in linear light,
 * as the WebGPU chain's. The program is built at the first chain; the state a reduction touches —
 * program, framebuffer, viewport, vertex array, colour mask, capabilities — is restored after it,
 * so it may run in the middle of a pass.
 */
export class WebglMipReducer {
  private gl: WebGL2RenderingContext;
  private built:
    | {
        program: WebGLProgram;
        source: WebGLUniformLocation | null;
        weighted: WebGLUniformLocation | null;
        framebuffer: WebGLFramebuffer;
        vertexArray: WebGLVertexArrayObject;
      }
    | undefined;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }
  private build() {
    const gl = this.gl,
      program = createWebglProgram(gl, FULLSCREEN_VERTEX, FRAGMENT);
    return {
      program,
      source: gl.getUniformLocation(program, 'source'),
      weighted: gl.getUniformLocation(program, 'weighted'),
      framebuffer: gl.createFramebuffer()!,
      vertexArray: gl.createVertexArray()!,
    };
  }
  /** Draws levels 1… of `chain.texture`, bound on the active `unit`'s TEXTURE_2D, each from the
   *  one above it, `weighted` or not; `allocate` first gives them storage — a new size, or a
   *  first chain. */
  reduce(unit: number, chain: Chain, weighted: boolean, allocate: boolean) {
    const gl = this.gl,
      { texture, format, width, height } = chain;
    const levels = mipLevelCountFor(width, height);
    if (levels === 1) return;
    const built = (this.built ??= this.build());
    const saved = {
      program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
      framebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
      viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
      vertexArray: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
      mask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
      toggles: TOGGLES.map((name) => gl.isEnabled(gl[name])),
    };
    setFullscreenPassState(gl);
    gl.disable(gl.STENCIL_TEST);
    gl.useProgram(built.program);
    gl.uniform1i(built.source, unit);
    gl.uniform1i(built.weighted, weighted ? 1 : 0);
    gl.bindVertexArray(built.vertexArray);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, built.framebuffer);
    for (let level = 1; level < levels; level++) {
      const [w, h] = levelSize(width, height, level);
      if (allocate)
        gl.texImage2D(gl.TEXTURE_2D, level, format, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, level - 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, level - 1);
      gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        level,
      );
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, saved.framebuffer);
    gl.bindVertexArray(saved.vertexArray);
    gl.useProgram(saved.program);
    gl.viewport(saved.viewport[0], saved.viewport[1], saved.viewport[2], saved.viewport[3]);
    gl.colorMask(saved.mask[0], saved.mask[1], saved.mask[2], saved.mask[3]);
    TOGGLES.forEach((name, i) => saved.toggles[i] && gl.enable(gl[name]));
  }
  dispose() {
    const { gl, built } = this;
    if (!built) return;
    gl.deleteProgram(built.program);
    gl.deleteFramebuffer(built.framebuffer);
    gl.deleteVertexArray(built.vertexArray);
    this.built = undefined;
  }
}
