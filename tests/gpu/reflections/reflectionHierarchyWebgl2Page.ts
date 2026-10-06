// Page side of the WebGL2 reflection proof: the complete cluster program compiled, then the
// reflection capture target of a 7 × 5 frame — odd both ways — filled by a source whose top-right
// texel differs, and its radiance and depth hierarchies read back at their deeper levels.
import { target } from '../../../packages/sdk-browser/src/reflections/captureGl.ts'
import { REFLECTION_BOUNDS_UNIT } from '../../../packages/sdk-browser/src/reflections/pyramidGl.ts'
import { LTC_UNIT } from '../../../packages/sdk-browser/src/webgl/cluster/rectGlsl.ts'
import { createWebglProgram } from '../../../packages/sdk-browser/src/webgl/core/program.ts'
import { FULLSCREEN_VERTEX } from '../../../packages/sdk-browser/src/webgl/core/fullscreenPass.ts'
import { createClusterProgram } from '../../../packages/sdk-browser/src/webgl/cluster/program.ts'

/** Colour 1, 2, 4 at depth 0.25 everywhere but the top-right texel: 16, 32, 64, alpha 0, at 0.875. */
const SOURCE = `#version 300 es
precision highp float;out vec4 color;
void main(){color=vec4(1.0,2.0,4.0,1.0);gl_FragDepth=0.25;
if(gl_FragCoord.x>6.0&&gl_FragCoord.y>4.0){color=vec4(16.0,32.0,64.0,0.0);gl_FragDepth=0.875;}}`

/** Level 2 of the radiance (red, alpha) and level 1 of the depth bounds (near, far), at texel 0. */
const READ = `#version 300 es
precision highp float;precision highp int;uniform highp sampler2D image;uniform highp usampler2D bounds;
out vec4 color;void main(){vec4 c=texelFetch(image,ivec2(0),2);
vec2 d=uintBitsToFloat(texelFetch(bounds,ivec2(0),1).rg);color=vec4(c.r,c.a,d);}`

export function execute() {
  const canvas = document.createElement('canvas')
  canvas.width = 7
  canvas.height = 5
  const gl = canvas.getContext('webgl2')
  if (!gl || !gl.getExtension('EXT_color_buffer_float'))
    throw new Error('WebGL2 with float targets unavailable')
  // The complete material program, not the cone's helpers alone.
  gl.deleteProgram(createClusterProgram(gl))
  const frozen = target(gl)
  const source = createWebglProgram(gl, FULLSCREEN_VERTEX, SOURCE)
  gl.viewport(0, 0, 7, 5)
  frozen.begin(null)
  gl.useProgram(source)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.ALWAYS)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  frozen.end()
  frozen.bind()
  const reductionError = gl.getError()
  const output = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, output)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1)
  const framebuffer = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0)
  const read = createWebglProgram(gl, FULLSCREEN_VERTEX, READ)
  gl.useProgram(read)
  // The capture's radiance sits on the unit after the area-light tables (`captureGl.ts`).
  gl.uniform1i(gl.getUniformLocation(read, 'image'), LTC_UNIT + 1)
  gl.uniform1i(gl.getUniformLocation(read, 'bounds'), REFLECTION_BOUNDS_UNIT)
  gl.disable(gl.DEPTH_TEST)
  gl.viewport(0, 0, 1, 1)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  const values = new Float32Array(4)
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, values)
  const error = gl.getError()
  frozen.dispose()
  for (const program of [source, read]) gl.deleteProgram(program)
  gl.deleteTexture(output)
  gl.deleteFramebuffer(framebuffer)
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return { values: Array.from(values), reductionError, error }
}
