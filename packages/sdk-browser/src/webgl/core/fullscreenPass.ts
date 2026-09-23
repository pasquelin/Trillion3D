/** One triangle over the whole viewport, from `gl_VertexID` alone: no buffer, no attribute. */
export const FULLSCREEN_VERTEX = `#version 300 es
void main(){gl_Position=vec4(float((gl_VertexID&1)*4-1),float((gl_VertexID>>1)*4-1),0.,1.);}`;

/**
 * The raster state of a copy pass: depth, blending, culling, scissor and dithering off, every
 * channel written. A full-screen pass owes nothing to the state the previous draw left behind,
 * and dithering would alter bytes a copy must carry unchanged.
 */
export function setFullscreenPassState(gl: WebGL2RenderingContext) {
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.DITHER);
  gl.colorMask(true, true, true, true);
}
