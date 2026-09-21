import { boundToContext } from './webglContextBound.ts';
import { FULLSCREEN_VERTEX, setFullscreenPassState } from './webglFullscreenPass.ts';
import { createWebglProgram } from './webglProgram.ts';
import { bindWebglTarget, type WebglRenderTarget } from './webglRenderTarget.ts';

export type ComparisonLayout = 'single' | 'side-by-side' | 'wipe' | 'toggle' | 'difference';

const LAYOUT_IDS: Record<ComparisonLayout, number> = {
  single: 0,
  'side-by-side': 1,
  wipe: 2,
  toggle: 3,
  difference: 4,
};

/** Both sides hold display images: the texels are copied as they are, and a difference is the
 *  difference of what the two single views would show. `size` is the drawing buffer's. */
const FRAGMENT = `#version 300 es
precision highp float;uniform sampler2D mapA;uniform sampler2D mapB;uniform vec2 size;
uniform int mode;uniform float wipe;uniform int toggle;out vec4 color;
vec4 sideA(vec2 uv){return texture(mapA,uv);}
vec4 sideB(vec2 uv){return texture(mapB,uv);}
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
      const handle = createWebglProgram(gl, FULLSCREEN_VERTEX, FRAGMENT),
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
      };
    },
    ({ handle, vao }) => {
      gl.deleteProgram(handle);
      gl.deleteVertexArray(vao);
    },
  );
  return {
    /** Draws the layout over the whole drawing buffer. */
    render(
      a: WebglRenderTarget,
      b: WebglRenderTarget,
      layout: ComparisonLayout,
      wipe: number,
      toggle: 0 | 1,
    ) {
      const current = program.current();
      if (!current) return;
      const { width, height } = bindWebglTarget(gl, null);
      setFullscreenPassState(gl);
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
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose: program.dispose,
  };
}
