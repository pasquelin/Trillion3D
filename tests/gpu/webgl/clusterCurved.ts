// A lit flat triangle and a lit metal sphere, each drawn by the engine's WebGL2 cluster program and
// by the witness renderer from the same inputs: the images the cluster renderer proof compares.
import * as THREE from 'three'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import {
  threeCamera,
  threeGraph,
  threeMeshCopy,
} from '../../../bench/witnesses/three/fromGraphNodes.ts'
import { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts'
import {
  createHostDrawCamera,
  readHostDrawCamera,
} from '../../../packages/sdk-browser/src/camera/world.ts'
import { keptClusterScene } from '../../../bench/witnesses/exact/keptClusterScene.ts'
import { drawMatrix, strictDegraded } from './clusterPixels.ts'

/** Every pixel of a `size`² drawing buffer, bottom row first. */
export const curvedPixels = (gl: WebGLRenderingContext | WebGL2RenderingContext, size: number) => {
  const output = new Uint8Array(size * size * 4)
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, output)
  return output
}

/** A witness renderer on a canvas of its own, with the display chain the engine's program uses:
 *  sRGB output, no tone mapping, a black clear. */
export function witnessRenderer(size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0, 1)
  return renderer
}

/** The centre pixel of the triangle of the renderer proof, rough dark red under a sun at its
 *  normal, drawn by the witness: the bytes the engine's sun and Fresnel must give. */
export function planarWitness() {
  const renderer = witnessRenderer(32),
    geometry = new THREE.BufferGeometry(),
    material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }),
    scene = new THREE.Scene(),
    light = new THREE.DirectionalLight(0xffffff, 1)
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2]), 3),
  )
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  )
  geometry.setIndex([0, 1, 2])
  material.color.setRGB(0.18, 0, 0, THREE.LinearSRGBColorSpace)
  light.position.set(0, 0, 1)
  scene.add(new THREE.Mesh(geometry, material), light, light.target)
  renderer.render(scene, new THREE.PerspectiveCamera(60, 1, 0.1, 10))
  const centre = (16 * 32 + 16) * 4
  const result = [...curvedPixels(renderer.getContext(), 32).slice(centre, centre + 4)]
  renderer.dispose()
  geometry.dispose()
  material.dispose()
  return result
}

/** A polished metal sphere under a sun, as both renderers receive it. */
const sceneInputs = () => {
  const geometry = G.sphereGeometry(1, 32, 16)
  if (!geometry.index) throw new Error('the sphere has no index')
  geometry.setIndex(new G.BufferAttribute(Uint32Array.from(geometry.index.array), 1))
  const material = G.standardSurface({ roughness: 0.35, metalness: 0.8 })
  ;(material.color as G.Color).setRGB(0.18, 0.18, 0.18)
  const camera = G.perspectiveCamera(60, 1, 0.1, 10),
    light = G.directionalLight(0xffffff, 1)
  light.position.set(1, 1, 2)
  const scene = new G.Scene()
  scene.add(light, light.target)
  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)
  return { geometry, material, camera, scene }
}

/** The sphere `offset` to the side, 3 in front, in a `size`² view: drawn by the engine (`raw`)
 *  and by the witness (`reference`), their channel gaps, lit pixels and centre pixels — with
 *  both images when `details`. */
export function curvedComparison(size = 64, offset = 0, details = false) {
  const rawCanvas = document.createElement('canvas')
  rawCanvas.width = rawCanvas.height = size
  const rawGl = rawCanvas.getContext('webgl2', { antialias: false }),
    input = sceneInputs()
  if (!rawGl) throw new Error('WebGL2 unavailable')
  rawGl.viewport(0, 0, size, size)
  rawGl.clearColor(0, 0, 0, 1)
  rawGl.clear(rawGl.COLOR_BUFFER_BIT | rawGl.DEPTH_BUFFER_BIT)
  const rawRenderer = new WebglClusterRenderer(rawGl, strictDegraded()),
    matrix = drawMatrix(),
    index = input.geometry.index!
  matrix.makeTranslation(offset, 0, -3)
  const record = {
    geometry: { index, attributes: input.geometry.attributes },
    material: input.material,
    renderOrder: 0,
    polygonOffsetUnits: undefined,
    matrix,
    _multiDrawCounts: new Int32Array([index.count]),
    _multiDrawStarts: new Int32Array([0]),
    _multiDrawCount: 1,
  }
  const drawCamera = readHostDrawCamera(createHostDrawCamera(), input.camera)
  rawRenderer.draw([record], keptClusterScene(input.scene), drawCamera, false, true)
  const raw = curvedPixels(rawGl, size)

  const witness = witnessRenderer(size),
    witnessInput = sceneInputs(),
    witnessScene = threeGraph(witnessInput.scene),
    mesh = threeMeshCopy(witnessInput)
  mesh.matrix.fromArray(matrix.elements)
  mesh.matrixAutoUpdate = false
  witnessScene.add(mesh)
  witness.render(witnessScene, threeCamera(witnessInput.camera))
  const reference = curvedPixels(witness.getContext(), size)

  let changed = 0,
    max = 0,
    rawNonBlack = 0
  for (let i = 0; i < raw.length; i += 4) {
    let pixelChanged = false
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(raw[i + channel] - reference[i + channel])
      if (delta) pixelChanged = true
      if (delta > max) max = delta
    }
    if (pixelChanged) changed++
    if (raw[i] || raw[i + 1] || raw[i + 2]) rawNonBlack++
  }
  const middle = Math.floor(size / 2),
    center = (middle * size + middle) * 4
  const result = {
    changed,
    max,
    rawNonBlack,
    rawCenter: [...raw.slice(center, center + 4)],
    referenceCenter: [...reference.slice(center, center + 4)],
  }
  rawRenderer.dispose()
  witness.dispose()
  for (const { geometry, material } of [input, witnessInput]) {
    geometry.dispose()
    material.dispose()
  }
  return details ? { ...result, raw, reference } : result
}
