import { createWebglProgram } from '../core/program.ts';
import { CoverageReaders, mipsWeighByAlpha } from '../../texture/coverage.ts';
import { surfaceOf } from '../../page/surface.ts';
import type { HostMaterials } from '../../host/resources.ts';
import {
  previewLastLevel,
  previewLevelSize,
  type Texture,
} from '../../../../sdk-core/src/index.ts';

const VERTEX = `#version 300 es
void main(){
 gl_Position=vec4(float((gl_VertexID&1)*4-1),float((gl_VertexID>>1)*4-1),0.0,1.0);
}`;

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
const TOGGLES = ['BLEND', 'CULL_FACE', 'DEPTH_TEST', 'SCISSOR_TEST', 'STENCIL_TEST'] as const;

/**
 * The material mip chain on WebGL2 (#42): one draw per level into a framebuffer on that level, in
 * place of `generateMipmap`'s box filter, which averages alpha and darkens the borders of masked
 * foliage. An sRGB texture is read decoded and written encoded: the reduction runs in linear light,
 * as the WebGPU chain's. The program is built at the first chain; the state a reduction touches —
 * program, framebuffer, viewport, vertex array, colour mask, capabilities — is restored after it,
 * so it may run in the middle of a pass.
 */
export class WebglMipChains {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | undefined;
  private framebuffer: WebGLFramebuffer | undefined;
  private vertexArray: WebGLVertexArrayObject | undefined;
  /** The readers of each colour map in the frame (`follow`): they say whether its chain weighs
   *  by alpha, and a chain is reduced again when their rule moves. */
  private readers = new CoverageReaders();
  /** Each texture's rule, read once a frame. */
  private rules = new Map<Texture, boolean>();
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }
  /** A new frame: the readers of the colour maps are the surfaces it draws. */
  follow(materials: Iterable<HostMaterials>) {
    this.rules.clear();
    this.readers.clear();
    for (const material of materials) this.readers.read(surfaceOf(material));
  }
  /** Whether a texture's chain weighs by alpha in this frame (`mipsWeighByAlpha`). */
  weighs(texture: Texture) {
    let rule = this.rules.get(texture);
    if (rule === undefined)
      this.rules.set(texture, (rule = mipsWeighByAlpha(texture, this.readers.coverage(texture))));
    return rule;
  }
  /** Draws levels 1… of `texture`, bound on the active `unit`'s TEXTURE_2D, each from the one
   *  above it; `allocate` first gives them storage — a new size, or a first chain. */
  reduce(
    unit: number,
    texture: WebGLTexture,
    format: number,
    [width, height]: readonly [number, number],
    weighted: boolean,
    allocate: boolean,
  ) {
    const gl = this.gl;
    const levels = previewLastLevel(width, height) + 1;
    if (levels === 1) return;
    const program = (this.program ??= createWebglProgram(gl, VERTEX, FRAGMENT));
    const saved = {
      program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
      framebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
      viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
      vertexArray: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
      mask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
      toggles: TOGGLES.map((name) => gl.isEnabled(gl[name])),
    };
    for (const name of TOGGLES) gl.disable(gl[name]);
    gl.colorMask(true, true, true, true);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'source'), unit);
    gl.uniform1i(gl.getUniformLocation(program, 'weighted'), weighted ? 1 : 0);
    gl.bindVertexArray((this.vertexArray ??= gl.createVertexArray()!));
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, (this.framebuffer ??= gl.createFramebuffer()!));
    for (let level = 1; level < levels; level++) {
      const [w, h] = previewLevelSize(width, height, level);
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
    const gl = this.gl;
    if (this.program) gl.deleteProgram(this.program);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.vertexArray) gl.deleteVertexArray(this.vertexArray);
  }
}
