import { FULLSCREEN_VERTEX, setFullscreenPassState } from './webglFullscreenPass.ts';
import { createWebglProgram } from './webglProgram.ts';

/** Engine-owned WebGL2 copy of a canvas into the bound framebuffer. The engine presents its image
 *  with WebGPU on its own canvas; a host whose surface is WebGL2 receives it through this program.
 *  No renderer and no scene object: the pixels are read as they were written, without a colour
 *  conversion on either side — the source and the destination both hold display bytes. */

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
  const program = createWebglProgram(gl, FULLSCREEN_VERTEX, FRAGMENT);
  const texture = gl.createTexture()!,
    vao = gl.createVertexArray()!;
  const image = gl.getUniformLocation(program, 'image');
  // Filtering belongs to the texture and the sampler unit to the program: set once, they survive
  // every draw. What follows in `draw` is context state other programs write too.
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.useProgram(program);
  gl.uniform1i(image, 0);
  return {
    /** Uploads `source` as raw bytes and draws it over the whole viewport. */
    draw(source: HTMLCanvasElement) {
      setFullscreenPassState(gl);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
