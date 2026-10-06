// Mirrored placements against the witness: a triangle mirrored by its model matrix, then by a
// mirrored parent of the camera, drawn by the cluster program and by the witness renderer. A
// mirror flips the winding, and which face shows must be the witness's in both.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import * as THREE from 'three'
import { threeCamera, threeMeshCopy } from '../../../bench/witnesses/three/fromGraphNodes.ts'
import { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts'
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../../packages/sdk-browser/src/camera/world.ts'
import { keptClusterScene } from '../../../bench/witnesses/exact/keptClusterScene.ts'
import { pixel, strictDegraded } from './clusterPixels.ts'
import { triangle } from './clusterRig.ts'
import { witnessRenderer } from './clusterCurved.ts'

export function windingComparisons() {
  const rawCanvas = document.createElement('canvas')
  rawCanvas.width = rawCanvas.height = 32
  const gl = rawCanvas.getContext('webgl2', { antialias: false })
  if (!gl) throw new Error('WebGL2 unavailable')
  const raw = new WebglClusterRenderer(gl, strictDegraded()),
    witness = witnessRenderer(32),
    { mesh, material, geometry } = triangle(),
    scene = new G.Scene(),
    witnessScene = new THREE.Scene(),
    witnessMesh = threeMeshCopy({ geometry, material }),
    camera = G.perspectiveCamera(60, 1, 0.1, 10),
    rig = new G.Object3D()
  witnessMesh.matrixAutoUpdate = false
  witnessScene.add(witnessMesh)
  rig.add(camera)
  gl.viewport(0, 0, 32, 32)
  gl.clearColor(0, 0, 0, 1)
  const render = (modelMirror: boolean, cameraMirror: boolean) => {
    mesh.matrix.makeScale(modelMirror ? -1 : 1, 1, 1)
    witnessMesh.matrix.fromArray(mesh.matrix.elements)
    rig.scale.set(cameraMirror ? -1 : 1, 1, 1)
    rig.updateMatrixWorld(true)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    const drawCamera = readHostDrawCamera(createHostDrawCamera(), camera)
    raw.draw([mesh], keptClusterScene(scene), drawCamera, false, true)
    const owned = pixel(gl)
    witness.render(witnessScene, threeCamera(camera))
    return { owned, witness: pixel(witness.getContext() as WebGL2RenderingContext) }
  }
  const result = { modelMirror: render(true, false), cameraMirror: render(false, true) }
  raw.dispose()
  witness.dispose()
  geometry.dispose()
  material.dispose()
  return result
}
