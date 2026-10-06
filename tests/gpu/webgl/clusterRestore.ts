// A held frame across a lost and restored WebGL2 context: the engine's surface, its cluster owner
// and the frame composer, drawing a textured triangle whose texture changed while the frame was
// held. After the restore the frame is drawn again, from the texture as it now stands — never the
// kept copy of a context that is gone.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { WebglClusterOwner } from '../../../packages/sdk-browser/src/webgl/cluster/owner.ts'
import { createFrameComposer } from '../../../packages/sdk-browser/src/world/render/compose.ts'
import { prepareExplorerWebglSurface } from '../../../packages/sdk-browser/src/world/render/webglHost.ts'
import { baseCapabilities } from '../../../bench/witnesses/capabilities.ts'
import type { HostDrawCamera } from '../../../packages/sdk-browser/src/camera/world.ts'
import { IDENTITY_MATRIX4 } from '../../../packages/sdk-core/src/index.ts'
import { keptClusterScene } from '../../../bench/witnesses/exact/keptClusterScene.ts'
import { pixel, strictHearer } from './clusterPixels.ts'

/** Resolves once `read` holds, frame after frame, or rejects after two seconds. */
export const waitFor = (read: () => boolean) =>
  new Promise<void>((resolve, reject) => {
    const start = performance.now()
    const poll = () => {
      if (read()) resolve()
      else if (performance.now() - start > 2000) reject(new Error('WebGL context event timeout'))
      else requestAnimationFrame(poll)
    }
    poll()
  })

/** Paints one flat colour into a 1 × 1 canvas: the cheapest change of a texture's content. */
const paint = (image: HTMLCanvasElement, color: string) => {
  const context = image.getContext('2d')
  if (!context) throw new Error('2d context unavailable')
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
}

const texturedTriangle = () => {
  const geometry = new G.Geometry()
  geometry.setAttribute(
    'position',
    new G.BufferAttribute(new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2]), 3),
  )
  geometry.setAttribute('uv', new G.BufferAttribute(new Float32Array(6), 2))
  geometry.setIndex(new G.BufferAttribute(new Uint32Array([0, 1, 2]), 1))
  const index = geometry.index
  if (!index) throw new Error('the triangle needs an indexed geometry')
  const image = document.createElement('canvas')
  image.width = image.height = 1
  const texture = G.canvasTexture(image)
  const material = G.basicSurface({ map: texture })
  return {
    image,
    texture,
    geometry,
    material,
    mesh: {
      geometry: { index, attributes: geometry.attributes },
      material: material as G.GraphSurface | G.GraphSurface[],
      renderOrder: 0,
      polygonOffsetUnits: undefined,
      matrix: { elements: new Float64Array(IDENTITY_MATRIX4) },
      _multiDrawCounts: new Int32Array([3]),
      _multiDrawStarts: new Int32Array([0]),
      _multiDrawCount: 1,
    },
  }
}

/** Draws red, holds the frame, turns the texture lime, loses and restores the context, draws
 *  again: how many times the engine drew, and the pixel after the restore. */
export async function heldRestore() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 8
  document.body.append(canvas)
  const events: ('lost' | 'restored')[] = [],
    surface = prepareExplorerWebglSurface({
      canvas,
      size: { width: 8, height: 8 },
      onLifecycle: (state) => events.push(state),
    }),
    gl = surface.context,
    scene = new G.Scene(),
    fixture = texturedTriangle(),
    owner = new WebglClusterOwner(gl, strictHearer)
  let draws = 0
  const backend = {
    id: 'restore',
    capabilities: baseCapabilities,
    scene,
    frameHeld: false,
    overBudget: false,
    prepare: async () => {},
    render: () => {},
    metrics: () => ({}),
    dispose: () => {},
    drawHostGeometry: (drawCamera: HostDrawCamera) => {
      draws++
      owner.draw([fixture.mesh], keptClusterScene(scene), drawCamera, false, true)
    },
  }
  paint(fixture.image, 'red')
  fixture.texture.needsUpdate = true
  const draw = createFrameComposer(gl, G.perspectiveCamera())
  draw(backend, null)
  backend.frameHeld = true
  paint(fixture.image, 'lime')
  fixture.texture.needsUpdate = true
  const extension = gl.getExtension('WEBGL_lose_context')
  if (!extension) throw new Error('WEBGL_lose_context unavailable')
  extension.loseContext()
  await waitFor(() => events.includes('lost'))
  extension.restoreContext()
  await waitFor(() => events.includes('restored'))
  draw(backend, null)
  const restoredPixel = pixel(gl, 4, 4)
  draw.dispose()
  owner.dispose()
  fixture.geometry.dispose()
  fixture.material.dispose()
  fixture.texture.dispose()
  surface.dispose()
  return { draws, restoredPixel }
}
