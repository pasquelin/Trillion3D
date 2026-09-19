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

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'BLIT_SHADER';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

/**
 * Full-screen copy program on a context the caller owns. The caller sets the viewport and binds
 * the destination framebuffer; nothing else about the host's state is assumed.
 */
export function createCanvasBlit(gl: WebGL2RenderingContext) {
  const program = gl.createProgram()!;
  const shaders: WebGLShader[] = [];
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
      const shader = compile(gl, type, source);
      shaders.push(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? 'BLIT_PROGRAM');
  } catch (error) {
    for (const shader of shaders) gl.deleteShader(shader);
    gl.deleteProgram(program);
    throw error;
  }
  for (const shader of shaders) gl.deleteShader(shader);
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
    /** Uploads `source` and draws it over the whole viewport. Depth, blending and culling are
     *  turned off here: the copy owes nothing to the state the host left behind. */
    draw(source: HTMLCanvasElement) {
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
