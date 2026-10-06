// Page side of the surface proof: the engine-owned WebGL2 surface of a world, resized to the same
// size, then to another at its declared pixel ratio, its context lost and restored, then disposed.
import { prepareExplorerWebglSurface } from '../../../packages/sdk-browser/src/world/render/webglHost.ts'
import { waitFor } from './clusterRestore.ts'

/** Fills the drawing buffer with `color` by a full-screen triangle of its own program, and reads
 *  the bottom-left pixel back. */
function draw(gl: WebGL2RenderingContext, color: number[]) {
  const vertex = gl.createShader(gl.VERTEX_SHADER),
    fragment = gl.createShader(gl.FRAGMENT_SHADER),
    program = gl.createProgram()
  if (!vertex || !fragment || !program) throw new Error('WebGL2 shader objects unavailable')
  gl.shaderSource(
    vertex,
    '#version 300 es\nvoid main(){gl_Position=vec4(-1.+float(gl_VertexID&1)*4.,-1.+float((gl_VertexID>>1)&1)*4.,0.,1.);}',
  )
  gl.shaderSource(
    fragment,
    `#version 300 es\nprecision highp float;out vec4 outColor;void main(){outColor=vec4(${color.join(',')});}`,
  )
  gl.compileShader(vertex)
  gl.compileShader(fragment)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.useProgram(program)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  const pixel = read(gl)
  gl.deleteProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  return pixel
}

/** The bottom-left pixel of the drawing buffer. */
function read(gl: WebGL2RenderingContext) {
  const pixel = new Uint8Array(4)
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
  return [...pixel]
}

export async function execute() {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const events: ('lost' | 'restored')[] = []
  const surface = prepareExplorerWebglSurface({
    canvas,
    onLifecycle: (state) => events.push(state),
  })
  surface.resize(32, 16, 2)
  const before = draw(surface.context, [1, 0, 0, 1])
  surface.resize(32, 16, 2)
  const afterSameSize = read(surface.context)
  surface.resize(16, 8, 2)
  const afterResize = draw(surface.context, [0, 1, 0, 1])
  const extension = surface.context.getExtension('WEBGL_lose_context')
  if (!extension) throw new Error('WEBGL_lose_context unavailable')
  extension.loseContext()
  await waitFor(() => events.includes('lost'))
  extension.restoreContext()
  await waitFor(() => events.includes('restored'))
  const afterRestore = draw(surface.context, [0, 0, 1, 1])
  surface.dispose()
  await waitFor(() => surface.context.isContextLost())
  return {
    size: surface.size,
    before,
    afterSameSize,
    afterResize,
    afterRestore,
    events,
    disposed: surface.disposed,
    contextLostAfterDispose: surface.context.isContextLost(),
  }
}
