import { createWebglProgram } from './webglProgram.ts';

/** Engine-owned WebGL2 copy of a canvas into the bound framebuffer. The engine presents its image
 *  with WebGPU on its own canvas; a host whose surface is WebGL2 receives it through this program.
 *  No renderer and no scene object: the pixels are read as they were written, without a colour
 *  conversion on either side. */

const VERTEX = `#version 300 es
void main(){gl_Position=vec4(float((gl_VertexID&1)*4-1),float((gl_VertexID>>1)*4-1),0.,1.);}`;
/** Bottom-left destination, top-left source: the row is read upside down rather than the image
 *  copied twice. A readback of the result therefore lands in the SDK's bottom-left convention. */
const FRAGMENT = `#version 300 es
precision highp float;uniform sampler2D image;out vec4 color;
void main(){ivec2 sz=textureSize(image,0);
color=texelFetch(image,ivec2(int(gl_FragCoord.x),sz.y-1-int(gl_FragCoord.y)),0);}`;

/**
 * Full-screen copy program on a context the caller owns. The caller sets the viewport and binds
 * the destination framebuffer; nothing else about the host's state is assumed.
 */
export function createCanvasBlit(gl: WebGL2RenderingContext) {
  const program = createWebglProgram(gl, VERTEX, FRAGMENT);
  const texture = gl.createTexture()!,
    vao = gl.createVertexArray()!;
  const image = gl.getUniformLocation(program, 'image');
  // Filtering belongs to the texture and the sampler unit to the program: set once, they survive
  // every draw. What follows in `draw` is context state the host renderer writes too.
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.useProgram(program);
  gl.uniform1i(image, 0);
  return {
    /**
     * Uploads `source` and draws it over the whole viewport. Depth, blending and culling are
     * turned off here: the copy owes nothing to the state the host left behind.
     *
     * `srgbDestination` says that the bound attachment is sRGB encoded, as a host render target
     * is. The hardware encodes every fragment written there, with no way to turn it off, so the
     * source is then read as sRGB and decoded by the hardware too: the two conversions cancel and
     * the byte arrives as it left. Declared linear — the default framebuffer — nothing converts
     * on either side, and the byte arrives as it left as well. Getting this wrong brightens the
     * image once.
     */
    draw(source: HTMLCanvasElement, srgbDestination = false) {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DITHER);
      gl.colorMask(true, true, true, true);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const format = srgbDestination ? gl.SRGB8_ALPHA8 : gl.RGBA8;
      gl.texImage2D(gl.TEXTURE_2D, 0, format, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
