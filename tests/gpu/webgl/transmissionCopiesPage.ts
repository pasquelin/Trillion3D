// Page side of the transmission proof: what a transmissive scene copy lets through is the engine's
// own cluster image, opaque and blended, depth-tested both ways, attenuated by its volume and lit
// by a declared light; the backdrop follows a sub-viewport, costs nothing for a glass out of view,
// and a physical feature WebGL2 cannot draw is dropped from the glass and said once by name.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import type { ClusterDrawMesh } from '../../../packages/sdk-browser/src/cluster/batchMesh.ts'
import { readDegraded } from '../../../packages/sdk-browser/src/webgl/cluster/validation.ts'
import { keptClusterScene } from '../../../bench/witnesses/exact/keptClusterScene.ts'
import { clear, clusterRecord, mountClusterRenderer, pixel } from './clusterPixels.ts'
import { quad } from '../../kit/scenes/quad.ts'
import { listenMaterialDegraded } from './degradedNotices.ts'

/** A rough glass quad at depth 1, white, fully transmissive, shaped by `options`. */
const glassMesh = (options: G.SurfaceParameters = {}) => {
  const mesh = G.mesh(
    quad(-1),
    G.physicalSurface({ color: 0xffffff, transmission: 1, roughness: 1, ...options }),
  )
  mesh.matrixAutoUpdate = false
  return mesh
}

export async function execute() {
  const notices = listenMaterialDegraded()
  const { gl, renderer, scene, drawCamera } = mountClusterRenderer(readDegraded(notices.hear))
  const red = clusterRecord(quad(-3), G.basicSurface({ color: 0xff0000 })),
    glass = glassMesh()
  scene.background = new G.Color(0x0000ff)
  /** The clusters then the copies, cleared first: what the draw submitted. */
  const draw = (clusters: ClusterDrawMesh[], copies: G.HostMesh[], srgb = false) => {
    clear(gl)
    return renderer.draw(clusters, keptClusterScene(scene), drawCamera, false, srgb, [], copies)
  }
  const passes = () => ({
    backdrop: renderer.backdropSubmissions,
    copies: renderer.copySubmissions,
  })

  const withoutGlass = draw([red], [])
  const opaquePixel = pixel(gl)
  const submissions = { clusters: draw([red], [glass]), ...passes() }
  const throughGlass = pixel(gl)
  const restored = {
    framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
    viewport: [...gl.getParameter(gl.VIEWPORT)],
    backdropBytes: renderer.backdropBytes,
  }
  draw([red], [glass], true)
  const encoded = pixel(gl)
  // The background shows through where no cluster stands behind the glass.
  draw([], [glass])
  const backgroundThrough = pixel(gl)
  // A cluster in front of the glass hides it: shared depth, tested the usual way.
  const yellow = clusterRecord(quad(-0.5), G.basicSurface({ color: 0xffff00 }))
  draw([red, yellow], [glass])
  const occluded = pixel(gl)
  // A blended cluster behind the glass is part of what it lets through.
  const blue = clusterRecord(
    quad(-2),
    G.basicSurface({ color: 0x0000ff, transparent: true, opacity: 0.5 }),
  )
  draw([red, blue], [glass])
  const blendedThrough = pixel(gl)
  // The volume attenuates: half the light over one unit of thickness.
  const tinted = glassMesh({
    thickness: 1,
    attenuationDistance: 1,
    attenuationColor: new G.Color().setRGB(0.5, 0.5, 0.5),
  })
  draw([red], [tinted])
  const attenuated = pixel(gl)
  // A declared light reflects on the glass; its diffuse lobe cancels, its specular stays.
  const sun = G.directionalLight(0xffffff, 1)
  sun.position.set(0, 0, 1)
  scene.add(sun, sun.target)
  scene.updateMatrixWorld(true)
  draw([red], [glassMesh({ roughness: 0.5 })])
  const lit = pixel(gl)
  scene.clear()
  // A sub-viewport: the backdrop follows it, texel for texel, and nothing outside it moves.
  clear(gl)
  gl.viewport(8, 8, 16, 16)
  renderer.draw([red], keptClusterScene(scene), drawCamera, false, false, [], [glass])
  gl.viewport(0, 0, 32, 32)
  const subViewport = { inside: pixel(gl), outside: pixel(gl, 2, 2) }
  // A glass outside the view costs nothing: no copy submitted, no backdrop pass.
  const away = glassMesh()
  away.matrix.makeTranslation(100, 0, 0)
  away.updateWorldMatrix(false, false)
  away.geometry.computeBoundingBox()
  const offscreen = { clusters: draw([red], [away]), ...passes(), pixel: pixel(gl) }
  // Another physical extension is no refusal: the glass is drawn without it, said once by name.
  const coated = glassMesh({ name: 'coated glass', clearcoat: 0.5 })
  for (let frame = 0; frame < 2; frame++) draw([red], [coated])
  const coatedPixel = pixel(gl),
    coatedNotice = await notices.said()
  const drawError = gl.getError()
  renderer.dispose()
  return {
    withoutGlass,
    submissions,
    opaquePixel,
    throughGlass,
    encoded,
    restored,
    backgroundThrough,
    occluded,
    blendedThrough,
    attenuated,
    lit,
    subViewport,
    offscreen,
    coatedPixel,
    coatedNotice,
    drawError,
  }
}
