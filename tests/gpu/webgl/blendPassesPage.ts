// Page side of the blend proof: the engine's WebGL2 program drawing BLEND batch records in their
// range order, a two-sided one as two passes, MASK at its cutoff, a raised coplanar layer over its
// base, a diagnostic mesh, and the surfaces it refuses before drawing anything.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { triangleGeometry } from '../../../packages/sdk-browser/src/diagnostic/triangleDiagnostic.ts'
import { pageDiagnostics } from '../../../packages/sdk-browser/src/host/pageDiagnostics.ts'
import { asHostLibrary } from '../../../packages/sdk-browser/src/host/resources.ts'
import type { ClusterDrawMesh } from '../../../packages/sdk-browser/src/cluster/batchMesh.ts'
import { keptClusterScene } from '../../../bench/witnesses/exact/keptClusterScene.ts'
import { drawCoplanarBlend } from './coplanarBlend.ts'
import { clear, clusterRecord, mountClusterRenderer, pixel } from './clusterPixels.ts'

/** Two coplanar triangles, red then green by vertex colour, the first's winding reversed when
 *  asked. */
const geometry = (reverseFirst = false) => {
  const result = new G.Geometry()
  const corners = [-1, -1, -2, 1, -1, -2, 0, 1, -2]
  result.setAttribute(
    'position',
    new G.BufferAttribute(new Float32Array([...corners, ...corners]), 3),
  )
  const red = [1, 0, 0, 1, 0, 0, 1, 0, 0],
    green = [0, 1, 0, 0, 1, 0, 0, 1, 0]
  result.setAttribute('color', new G.BufferAttribute(new Float32Array([...red, ...green]), 3))
  const order = reverseFirst ? [0, 2, 1, 3, 4, 5] : [0, 1, 2, 3, 4, 5]
  result.setIndex(new G.BufferAttribute(new Uint32Array(order), 1))
  return result
}

export function execute() {
  const { gl, renderer, drawCamera, scene: graph } = mountClusterRenderer()
  const scene = keptClusterScene(graph)
  /** Clears, draws `records` (and the whole `meshes`), and reads the centre: what was submitted
   *  and the pixel. */
  const drawn = (records: ClusterDrawMesh[], meshes: G.HostMesh[] = []) => {
    clear(gl)
    const submitted = renderer.draw(records, scene, drawCamera, false, false, meshes)
    return { submitted, pixel: pixel(gl) }
  }
  /** Whether the draw of `records` is refused, and the pixel it left. */
  const refused = (records: ClusterDrawMesh[]) => {
    clear(gl)
    let rejected = false
    try {
      renderer.draw(records, scene, drawCamera, false, false)
    } catch {
      rejected = true
    }
    return { rejected, pixel: pixel(gl) }
  }
  const blend = G.basicSurface({
      transparent: true,
      opacity: 0.5,
      vertexColors: true,
      depthWrite: false,
    }),
    ordered = clusterRecord(geometry(), blend, [0, 3], [3, 3])
  const sourceOrder = drawn([ordered]).pixel
  ordered._multiDrawStarts = new Int32Array([12, 0])
  const reversedOrder = drawn([ordered]).pixel
  // The record carries the source material: its two passes are read at the draw.
  const double = G.basicSurface({
    transparent: true,
    opacity: 0.5,
    vertexColors: true,
    side: G.DOUBLE_SIDE,
  })
  const split = clusterRecord(geometry(true), double)
  const splitSubmissions = drawn([split]).submitted
  double.forceSinglePass = true
  const singleSubmissions = drawn([split]).submitted
  double.forceSinglePass = false
  const mask = G.basicSurface({ color: 0xff0000, opacity: 0.5, alphaTest: 0.4 })
  const single = clusterRecord(geometry(), mask, [0], [3])
  const maskPixel = drawn([single]).pixel
  mask.transparent = true
  const blendPixel = drawn([single]).pixel
  const lower = G.basicSurface({ color: 0xff0000, depthFunc: G.DEPTH_LESS }),
    raised = G.basicSurface({
      color: 0x00ff00,
      depthFunc: G.DEPTH_LESS,
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -8,
    })
  const coplanarPixel = drawn([
    clusterRecord(geometry(), lower, [0], [3]),
    clusterRecord(geometry(), raised, [0], [3]),
  ]).pixel
  clear(gl)
  const coplanarBlendSubmissions = drawCoplanarBlend(
    renderer,
    scene,
    drawCamera,
    geometry,
    lower,
    false,
  )
  const coplanarBlendWithoutBias = pixel(gl)
  clear(gl)
  drawCoplanarBlend(renderer, scene, drawCamera, geometry, lower, true)
  const coplanarBlendPixel = pixel(gl)
  const diagnosticGeometry = asHostLibrary<G.Geometry>(
      triangleGeometry(geometry(), pageDiagnostics),
    ),
    diagnostic = G.mesh(diagnosticGeometry, G.basicSurface({ vertexColors: true }))
  diagnostic.matrixAutoUpdate = false
  const diagnosticDrawn = drawn([], [diagnostic])
  double.visible = false
  const hidden = drawn([split])
  double.visible = true
  double.premultipliedAlpha = true
  const sourceMutation = refused([split])
  double.premultipliedAlpha = false
  // A material array set on a record is refused by name before any pass draws.
  split.material = [double, double]
  const mutation = refused([split])
  renderer.dispose()
  return {
    sourceOrder,
    reversedOrder,
    splitSubmissions,
    singleSubmissions,
    maskPixel,
    blendPixel,
    coplanarPixel,
    coplanarBlendSubmissions,
    coplanarBlendWithoutBias,
    coplanarBlendPixel,
    diagnosticSubmissions: diagnosticDrawn.submitted,
    diagnosticPixel: diagnosticDrawn.pixel,
    hiddenSubmissions: hidden.submitted,
    hiddenPixel: hidden.pixel,
    sourceMutationRejected: sourceMutation.rejected,
    sourceRejectionPixel: sourceMutation.pixel,
    mutationRejected: mutation.rejected,
    rejectionPixel: mutation.pixel,
  }
}
