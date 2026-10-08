/**
 * The host-library scene a witness draws with Three's WebGPU renderer: the background colour, the
 * source graph's meshes copied into the library, and its lights, each with the node it aims at.
 *
 * The engine itself lights a display graph of its own objects and names no library; a mesh or a
 * light of the engine's graph is copied into the library by `fromGraphNodes.ts`.
 */
import {
  installSceneLighting,
  type HostLight,
} from '../../../packages/sdk-browser/src/lighting/sceneLighting.ts'
import type { Light } from '../../../packages/sdk-core/src/world/light/light.ts'
import { asHostLibrary } from '../../../packages/sdk-browser/src/host/resources.ts'
import { meshes } from '../../../packages/sdk-browser/src/scene/meshes.ts'
import { copyMatrix4 } from '../../../packages/math/src/matrix/matrix4.ts'
import { threeLight, threeMeshCopy } from './fromGraphNodes.ts'
import * as THREE from 'three'
import type { Object3D } from '../../../packages/sdk-core/src/world/object/object3d.ts'

/** The clear colour a witness scene shows: written in place once a colour is there, nothing
 *  allocated. */
const paint = (scene: THREE.Scene, clearColor: number) => {
  if (scene.background instanceof THREE.Color) scene.background.setHex(clearColor)
  else scene.background = new THREE.Color(clearColor)
}

/** The witness scene's clear colour, then the source-graph lights placed on it. Building the host
 *  objects is the boundary's, the placement is not. */
export function lighting(scene: THREE.Scene, clearColor: number, source: Object3D) {
  paint(scene, clearColor)
  return installSceneLighting(scene, source, (light) =>
    asHostLibrary<HostLight>(threeLight(asHostLibrary<Light>(light))),
  )
}

/**
 * The source graph as a witness draws it: each drawn mesh copied once, in source order, and its
 * lights. `update()` poses the copies and the lights from the source's world matrices before a
 * frame; `lit()` says whether a light is installed, the only signal of a lit view (ACES and
 * exposure, identity otherwise).
 */
export function witnessScene(source: Object3D, clearColor: number) {
  const scene = new THREE.Scene()
  const lights = lighting(scene, clearColor, source)
  const copies: Array<[THREE.Mesh, { matrixWorld: { elements: ArrayLike<number> } }]> = []
  let order = 0
  for (const mesh of meshes(source)) {
    const copy = threeMeshCopy(mesh)
    copy.matrixAutoUpdate = false
    copy.renderOrder = order++
    scene.add(copy)
    copies.push([copy, mesh])
  }
  return {
    scene,
    lit: () => lights.lit,
    update() {
      source.updateMatrixWorld(true)
      lights.update()
      for (const [copy, mesh] of copies)
        copyMatrix4(copy.matrix.elements, mesh.matrixWorld.elements)
    },
    dispose: () => scene.clear(),
  }
}
