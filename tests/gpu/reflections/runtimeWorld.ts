// The generated world of the run-time proxy's proofs: an emissive sphere with a point light at its centre,
// on a thin post, over a polished metal floor, made at run time (`runtimeSceneFrame.ts` is its geometry).
import {
  createWorld,
  geometry,
  light,
  material,
  math,
  object,
} from '../../../packages/sdk-browser/src/index.ts'
import { FOV, KINDS, POST, SPHERE, type Kind } from './runtimeSceneFrame.ts'

/** The world of `kind` on `canvas`, the scene added and the camera posed. */
export function runtimeWorld(canvas: HTMLCanvasElement, kind: Kind = 'mirror') {
  const { eye, target, margin: _margin, ...floorLook } = KINDS[kind]
  const world = createWorld(canvas)
  world.scene.background = math.color('#05070d')
  const floor = object.mesh(geometry.box(60, 0.2, 60), material.meshStandard(floorLook))
  floor.position.y = -0.1
  const post = object.mesh(
    geometry.cylinder(POST.radius, POST.radius, POST.height, 16),
    material.meshStandard({ color: '#2b2f36', metalness: 0.8, roughness: 0.4 }),
  )
  post.position.set(0, POST.height / 2, 0)
  const globe = object.mesh(
    geometry.sphere(SPHERE.radius, 32, 16),
    material.meshStandard({ color: '#000000', emissive: '#ffcf8a', emissiveIntensity: 12 }),
  )
  globe.position.set(...SPHERE.centre)
  world.scene.add(
    floor,
    post,
    globe,
    light.point({ position: [...SPHERE.centre], color: '#ffcf8a', intensity: 18, distance: 10 }),
    light.hemisphere({ color: '#3a4c80', groundColor: '#0b0d12', intensity: 0.2 }),
  )
  world.camera.set({ position: [...eye], target: [...target], fov: FOV })
  return world
}
