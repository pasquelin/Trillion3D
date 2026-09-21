import { boundToContext } from './webglContextBound.ts';
import { DISPLAY_CHAIN_GLSL } from './webglDisplayChainGlsl.ts';
import { createWebglProgram } from './webglProgram.ts';
import type { WebglRenderTarget } from './webglRenderTarget.ts';

export type ComparisonLayout = 'single' | 'side-by-side' | 'wipe' | 'toggle' | 'difference';

const LAYOUT_IDS: Record<ComparisonLayout, number> = {
  single: 0,
  'side-by-side': 1,
  wipe: 2,
  toggle: 3,
  difference: 4,
};

const VERTEX = `#version 300 es
void main(){gl_Position=vec4(float((gl_VertexID&1)*4-1),float((gl_VertexID>>1)*4-1),0.,1.);}`;
/** Both sides are render targets: linear values, no tone mapping, decoded by the sampler. The
 *  display chain is applied here, per side, as the single view applies it on the canvas. */
const FRAGMENT = `#version 300 es
precision highp float;uniform sampler2D mapA;uniform sampler2D mapB;uniform vec2 size;
uniform int mode;uniform float wipe;uniform int toggle;uniform bool toneMappedA,toneMappedB;out vec4 color;
${DISPLAY_CHAIN_GLSL}
vec4 display(vec4 c,bool toneMapped){return vec4(linearToSrgb(toneMapped?aces(c.rgb):c.rgb),c.a);}
vec4 sideA(vec2 uv){return display(texture(mapA,uv),toneMappedA);}
vec4 sideB(vec2 uv){return display(texture(mapB,uv),toneMappedB);}
void main(){vec2 uv=gl_FragCoord.xy/size;
if(mode==1){color=uv.x<0.5?sideA(vec2(uv.x*2.0,uv.y)):sideB(vec2((uv.x-0.5)*2.0,uv.y));return;}
if(mode==2){color=uv.x<wipe?sideA(uv):sideB(uv);return;}
if(mode==3){color=toggle==0?sideA(uv):sideB(uv);return;}
if(mode==4){color=vec4(abs(sideA(uv).rgb-sideB(uv).rgb),1.0);return;}
color=sideA(uv);}`;

/**
 * The comparison compositor: an engine program that puts two render targets on the page's
 * drawing buffer in the layout asked for. It lives as long as the context does and is rebuilt
 * after a loss, like the presenter beside it.
 */
export function createComparisonCompositor(gl: WebGL2RenderingContext) {
  const program = boundToContext(
    gl,
    () => {
      const handle = createWebglProgram(gl, VERTEX, FRAGMENT),
        vao = gl.createVertexArray()!;
      const location = (name: string) => gl.getUniformLocation(handle, name);
      gl.useProgram(handle);
      gl.uniform1i(location('mapA'), 0);
      gl.uniform1i(location('mapB'), 1);
      return {
        handle,
        vao,
        size: location('size'),
        mode: location('mode'),
        wipe: location('wipe'),
        toggle: location('toggle'),
        toneMappedA: location('toneMappedA'),
        toneMappedB: location('toneMappedB'),
      };
    },
    ({ handle, vao }) => {
      gl.deleteProgram(handle);
      gl.deleteVertexArray(vao);
    },
  );
  return {
    /** Draws the layout over the whole drawing buffer; `toneMapped` says, per side, whether the
     *  engine that drew it lights its scene — the chain the single view would apply to it. */
    render(
      a: WebglRenderTarget,
      b: WebglRenderTarget,
      layout: ComparisonLayout,
      wipe: number,
      toggle: 0 | 1,
      toneMapped: readonly [boolean, boolean],
    ) {
      const current = program.current();
      if (!current) return;
      const width = gl.drawingBufferWidth,
        height = gl.drawingBufferHeight;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.useProgram(current.handle);
      gl.bindVertexArray(current.vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, b.texture);
      gl.uniform2f(current.size, width, height);
      gl.uniform1i(current.mode, LAYOUT_IDS[layout]);
      gl.uniform1f(current.wipe, Math.min(1, Math.max(0, wipe)));
      gl.uniform1i(current.toggle, toggle);
      gl.uniform1i(current.toneMappedA, toneMapped[0] ? 1 : 0);
      gl.uniform1i(current.toneMappedB, toneMapped[1] ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose: program.dispose,
  };
}
