import { LIGHT_LIST_UNIT } from '../webgl/cluster/lightTexture.ts';
import { RADIANCE_REDUCTION_GLSL } from '../texture/radianceReduction.ts';
import { levelSize, mipLevelCountFor } from '../texture/tiles.ts';
import {
  FULLSCREEN_VERTEX,
  FULLSCREEN_DISABLED,
  setFullscreenPassState,
} from '../webgl/core/fullscreenPass.ts';
import { createWebglProgram } from '../webgl/core/program.ts';

export const REFLECTION_BOUNDS_UNIT = LIGHT_LIST_UNIT + 1;

/** RG32UI preserves the exact depth bits without requiring float render targets.
 * Reduction reads only one accessible source mip, excluding the attached output mip. */
export class WebglReflectionPyramid {
  private bounds: WebGLTexture | null = null;
  private size = [0, 0];
  private framebuffer: WebGLFramebuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private programs = new Map<
    string,
    {
      program: WebGLProgram;
      source: WebGLUniformLocation | null;
      extent: WebGLUniformLocation | null;
    }
  >();
  private gl: WebGL2RenderingContext;
  private unit: number;
  constructor(gl: WebGL2RenderingContext, unit: number) {
    this.gl = gl;
    this.unit = unit;
  }
  private program(rule: 'radiance' | 'depth' | 'bounds') {
    let held = this.programs.get(rule);
    if (held) return held;
    const bounds = rule !== 'radiance';
    const load =
      rule === 'bounds'
        ? 'vec4(uintBitsToFloat(texelFetch(source,p,0).rg),0.0,1.0)'
        : rule === 'depth'
          ? '(texelFetch(source,p,0).r==1.0?vec4(1.0,0.0,0.0,0.0):vec4(vec2(texelFetch(source,p,0).r),0.0,1.0))'
          : 'texelFetch(source,p,0)';
    const code = `#version 300 es
precision highp float;precision highp int;
uniform highp ${rule === 'bounds' ? 'usampler2D' : 'sampler2D'} source;
uniform ivec4 extent;
const bool bounds=${bounds};
vec4 mipRead(ivec2 p){return ${load};}
${RADIANCE_REDUCTION_GLSL}
out ${bounds ? 'uvec2' : 'vec4'} color;
void main(){color=${bounds ? 'floatBitsToUint(radianceReduction(ivec2(gl_FragCoord.xy)).rg)' : 'radianceReduction(ivec2(gl_FragCoord.xy))'};}`;
    const program = createWebglProgram(this.gl, FULLSCREEN_VERTEX, code);
    held = {
      program,
      source: this.gl.getUniformLocation(program, 'source'),
      extent: this.gl.getUniformLocation(program, 'extent'),
    };
    this.programs.set(rule, held);
    return held;
  }
  get bytes() {
    let bytes = 0;
    for (let level = 1; level < mipLevelCountFor(...(this.size as [number, number])); level++) {
      const [w, h] = levelSize(this.size[0], this.size[1], level);
      bytes += w * h * 8;
    }
    return this.bounds ? Math.max(8, bytes) : 0;
  }
  encode(color: WebGLTexture, depth: WebGLTexture, width: number, height: number) {
    const gl = this.gl,
      levels = mipLevelCountFor(width, height);

    const saved = {
      program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
      framebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
      viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
      vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
      mask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
      toggles: FULLSCREEN_DISABLED.map((name) => gl.isEnabled(gl[name])),
    };
    gl.activeTexture(gl.TEXTURE0 + this.unit);
    if (!this.bounds || this.size[0] !== width || this.size[1] !== height) {
      if (this.bounds) gl.deleteTexture(this.bounds);
      this.bounds = gl.createTexture();
      this.size = [width, height];
      gl.bindTexture(gl.TEXTURE_2D, this.bounds);
      const [w, h] = levelSize(width, height, 1);
      gl.texStorage2D(gl.TEXTURE_2D, Math.max(1, levels - 1), gl.RG32UI, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    this.framebuffer ??= gl.createFramebuffer();
    this.vao ??= gl.createVertexArray();
    setFullscreenPassState(gl);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
    try {
      for (const channel of ['radiance', 'bounds'] as const)
        for (let level = 1; level < levels; level++) {
          const rule = channel === 'bounds' && level === 1 ? 'depth' : channel;
          const source = rule === 'depth' ? depth : channel === 'radiance' ? color : this.bounds;
          const target = channel === 'radiance' ? color : this.bounds;
          const inputLevel = rule === 'depth' ? 0 : level - (channel === 'radiance' ? 1 : 2);
          const outputLevel = level - Number(channel === 'bounds');
          const built = this.program(rule),
            [w, h] = levelSize(width, height, level);
          const [sw, sh] = levelSize(width, height, level - 1);
          gl.bindTexture(gl.TEXTURE_2D, source);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, inputLevel);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, inputLevel);
          gl.framebufferTexture2D(
            gl.DRAW_FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D,
            target,
            outputLevel,
          );
          gl.useProgram(built.program);
          gl.uniform1i(built.source, this.unit);
          gl.uniform4i(built.extent, sw, sh, width, height);
          gl.viewport(0, 0, w, h);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
          gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_MAX_LEVEL,
            source === depth ? 0 : levels - 1 - Number(source === this.bounds),
          );
        }
    } finally {
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, saved.framebuffer);
      gl.useProgram(saved.program);
      gl.bindVertexArray(saved.vao);
      gl.viewport(saved.viewport[0], saved.viewport[1], saved.viewport[2], saved.viewport[3]);
      gl.colorMask(saved.mask[0], saved.mask[1], saved.mask[2], saved.mask[3]);
      FULLSCREEN_DISABLED.forEach((name, index) => saved.toggles[index] && gl.enable(gl[name]));
    }
    this.bind();
  }
  bind() {
    this.gl.activeTexture(this.gl.TEXTURE0 + this.unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.bounds);
  }
  dispose() {
    const gl = this.gl;
    if (this.bounds) gl.deleteTexture(this.bounds);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const { program } of this.programs.values()) gl.deleteProgram(program);
    this.programs.clear();
    this.bounds = this.framebuffer = this.vao = null;
    this.size = [0, 0];
  }
}
