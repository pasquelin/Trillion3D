import { createWebglProgram } from '../core/program.ts';
import { FULLSCREEN_VERTEX } from '../core/fullscreenPass.ts';
import { floatTargets } from '../core/renderTarget.ts';
import { COVERAGE_PICK_GLSL, COVERAGE_SCALE_GLSL } from '../../texture/coverageRule.ts';
import { levelSize } from '../../texture/tiles.ts';

/** One point per texel of a level, on the column of its alpha byte — level 0's own, a level's
 *  median from the copy of the one above (`halved`) —, on row `id & 15` of the level's sixteen:
 *  no cell passes 2^24 texels, where a float stops counting. */
const COUNT = `#version 300 es
uniform highp sampler2D source;uniform ivec2 extent;uniform int columns;uniform bool halved;
${COVERAGE_SCALE_GLSL}
void main(){
 ivec2 p=ivec2(gl_VertexID%columns,gl_VertexID/columns);ivec2 q=p*2;ivec2 hi=extent-1;
 uint a=halved?median(vec4(texelFetch(source,min(q,hi),0).a,texelFetch(source,min(q+ivec2(1,0),hi),0).a,
  texelFetch(source,min(q+ivec2(0,1),hi),0).a,texelFetch(source,min(q+ivec2(1,1),hi),0).a))
  :uint(round(texelFetch(source,p,0).a*255.));
 gl_Position=vec4((float(a)+.5)/128.-1.,(float(gl_VertexID&15)+.5)/8.-1.,0.,1.);gl_PointSize=1.;
}`;
const ONE = `#version 300 es
precision highp float;out vec4 color;void main(){color=vec4(1.);}`;
/** The level's `t`, from level 0's rows and its own, as a byte in every channel. */
const PICK = `#version 300 es
precision highp float;precision highp int;
uniform highp sampler2D counts;uniform uint cutoff;uniform int level;uniform uvec2 texels;out vec4 color;
uint rows(uint bin,int from){uint n=0u;for(int r=0;r<16;r++)n+=uint(texelFetch(counts,ivec2(int(bin),from+r),0).r);return n;}
uint binOf(uint t){return rows(t,16*level);}
${COVERAGE_PICK_GLSL}
void main(){uint covered=0u;for(uint b=cutoff;b<256u;b++)covered+=rows(b,0);color=vec4(float(pick(cutoff,covered,texels))/255.);}`;

type Size = { width: number; height: number };

const BLEND_STATE = [
  'BLEND_SRC_RGB',
  'BLEND_DST_RGB',
  'BLEND_SRC_ALPHA',
  'BLEND_DST_ALPHA',
  'BLEND_EQUATION_RGB',
  'BLEND_EQUATION_ALPHA',
] as const;

/** The blend function and equation as they are now, which the counts replace: their restore. */
export function savedBlend(gl: WebGL2RenderingContext) {
  const [sr, dr, sa, da, er, ea] = BLEND_STATE.map((name) => gl.getParameter(gl[name]) as number);
  return () => {
    gl.blendFuncSeparate(sr, dr, sa, da);
    gl.blendEquationSeparate(er, ea);
  };
}

/** The programs, their uniforms, the counts' 256 × 256 float target and its framebuffer; null on
 *  a context that cannot add into it. Binds the counts on the active unit. */
function buildCounts(gl: WebGL2RenderingContext) {
  if (!floatTargets(gl) || !gl.getExtension('EXT_float_blend')) return null;
  const counts = gl.createTexture()!,
    frame = gl.createFramebuffer()!;
  gl.bindTexture(gl.TEXTURE_2D, counts);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, 256, 256);
  // A 32-bit float texture filters under no default: left to them, it is incomplete and every
  // `texelFetch` of the pick reads 0.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, frame);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, counts, 0);
  if (gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(frame);
    gl.deleteTexture(counts);
    return null;
  }
  const count = createWebglProgram(gl, COUNT, ONE),
    pick = createWebglProgram(gl, FULLSCREEN_VERTEX, PICK);
  const at = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);
  return {
    count,
    pick,
    counts,
    frame,
    source: at(count, 'source'),
    extent: at(count, 'extent'),
    columns: at(count, 'columns'),
    halved: at(count, 'halved'),
    sampled: at(pick, 'counts'),
    cutoff: at(pick, 'cutoff'),
    level: at(pick, 'level'),
    texels: at(pick, 'texels'),
  };
}

/**
 * The coverage rule's counts on WebGL2 (docs/FORMAT.md, "Coverage-preserving alpha"): every texel
 * adds one to its byte's cell by additive blending into a float target, which needs
 * `EXT_color_buffer_float` and `EXT_float_blend` — without them a chain keeps the median alone.
 * Level 0 fills rows 0–15, level `k` rows `16k`… (fifteen levels at most, a 16384 side); a
 * one-texel draw then writes `t` into the scratch, on the row under the level it holds.
 */
export class WebglCoverageCounts {
  private gl: WebGL2RenderingContext;
  private built: ReturnType<typeof buildCounts> | undefined;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }
  /** Whether this context counts, asked once: binds the draw framebuffer and the active unit. */
  ready() {
    if (this.built === undefined) this.built = buildCounts(this.gl);
    return this.built !== null;
  }
  /** Counts level `level` of a `width` × `height` chain — level 0 too at level 1 — from the scratch
   *  bound on `unit`, which holds the level above, and writes its `t` under it. Leaves the counts'
   *  framebuffer bound, holding the counts again — never the scratch, which `trim` must free —,
   *  blending off and its function additive (`savedBlend` gives it back). */
  count(unit: number, scratch: WebGLTexture, chain: Size, level: number, cutoff: number) {
    const gl = this.gl,
      { width, height } = chain,
      built = this.built!;
    const [sw, sh] = levelSize(width, height, level - 1),
      [w, h] = levelSize(width, height, level);
    const frame = gl.COLOR_ATTACHMENT0;
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, built.frame);
    if (level === 1) gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquation(gl.FUNC_ADD);
    gl.useProgram(built.count);
    gl.uniform1i(built.source, unit);
    gl.uniform2i(built.extent, sw, sh);
    for (const at of level === 1 ? [0, 1] : [level]) {
      const [side, rows] = levelSize(width, height, at);
      gl.uniform1i(built.columns, side);
      gl.uniform1i(built.halved, Number(at > 0));
      gl.viewport(0, 16 * at, 256, 16);
      gl.drawArrays(gl.POINTS, 0, side * rows);
    }
    gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, built.counts);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, frame, gl.TEXTURE_2D, scratch, 0);
    gl.useProgram(built.pick);
    gl.uniform1i(built.sampled, unit);
    gl.uniform1ui(built.cutoff, cutoff);
    gl.uniform1i(built.level, level);
    gl.uniform2ui(built.texels, width * height, w * h);
    gl.viewport(0, sh, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, frame, gl.TEXTURE_2D, built.counts, 0);
    gl.bindTexture(gl.TEXTURE_2D, scratch);
  }
  dispose() {
    const { gl, built } = this;
    if (!built) return;
    for (const program of [built.count, built.pick]) gl.deleteProgram(program);
    gl.deleteTexture(built.counts);
    gl.deleteFramebuffer(built.frame);
    this.built = undefined;
  }
}
