// Page side of the proof: two engine render targets on a real WebGL2 context, one holding a red
// display image, the other a blue one, composed on the drawing buffer by the engine's comparison
// program in every layout, and reread on both halves.
import {
  createComparisonCompositor,
  type ComparisonLayout,
} from '../../packages/sdk-browser/comparison.ts';
import {
  bindWebglTarget,
  createWebglRenderTarget,
} from '../../packages/sdk-browser/webglRenderTarget.ts';
import { WEBGL_CONTEXT_ATTRIBUTES } from '../../packages/sdk-browser/webglSurface.ts';
import { pixel } from './webglClusterPixels.ts';

const WIDTH = 64,
  HEIGHT = 32;
const LAYOUTS: ComparisonLayout[] = ['single', 'side-by-side', 'wipe', 'toggle', 'difference'];

/** A target filled with one display colour, as an engine's frame would leave it. */
function filled(gl: WebGL2RenderingContext, r: number, g: number, b: number) {
  const target = createWebglRenderTarget(gl, WIDTH, HEIGHT);
  bindWebglTarget(gl, target);
  gl.clearColor(r, g, b, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  bindWebglTarget(gl, null);
  return target;
}

export function execute() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.append(canvas);
  const gl = canvas.getContext('webgl2', WEBGL_CONTEXT_ATTRIBUTES);
  if (!gl) return { unavailable: 'WebGL2 unavailable' };
  try {
    const a = filled(gl, 0.6, 0, 0),
      b = filled(gl, 0, 0, 0.6),
      compositor = createComparisonCompositor(gl);
    const left = () => pixel(gl, WIDTH / 4, HEIGHT / 2),
      right = () => pixel(gl, (3 * WIDTH) / 4, HEIGHT / 2);
    const layouts: Record<string, { left: number[]; right: number[] }> = {};
    for (const layout of LAYOUTS) {
      compositor.render(a, b, layout, 0.5, 0);
      layouts[layout] = { left: left(), right: right() };
    }
    compositor.render(a, b, 'toggle', 0.5, 1);
    layouts.toggled = { left: left(), right: right() };
    compositor.dispose();
    a.dispose();
    b.dispose();
    return { layouts };
  } catch (error) {
    return { erreur: String(error) + (error instanceof Error ? (error.stack ?? '') : '') };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  }
}
