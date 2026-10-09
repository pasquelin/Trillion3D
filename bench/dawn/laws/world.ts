// The scale laws' open world, one source for both its forms: the scene cooked as a published one
// is (`cook.ts`) and the same world built in the page at run time (`world.html`, `runtime=<n>`),
// the bench mapping its import (`../page.ts`). Its ground reaches past the objects, which are
// pebbles, rocks and towers at their seeded places (`scatter.ts`), each kind one shape
// (`meshes.ts`) and one matte paint.
import type { SceneMesh } from './gltf.ts'
import { cylinder, ground, sphere } from './meshes.ts'
import { scatter, sideOf } from './scatter.ts'

/** Metres the ground reaches past the objects' square, all around together. */
const GROUND_MARGIN = 40

const matte = (r: number, g: number, b: number) => ({
  color: [r, g, b] as [number, number, number],
  roughness: 0.85,
  metalness: 0,
})

/** The open world of `count` objects: its meshes — the ground, then one a kind, in the kinds'
 *  order — and each kind's placements. */
export function lawWorld(count: number) {
  const meshes: SceneMesh[] = [
    {
      name: 'ground',
      data: ground(sideOf(count) + GROUND_MARGIN, 64),
      material: matte(0.42, 0.36, 0.27),
    },
    { name: 'pebble', data: sphere([0.15, 0.12, 0.15], 24, 16), material: matte(0.55, 0.53, 0.5) },
    { name: 'rock', data: sphere([0.9, 0.6, 0.8], 64, 40), material: matte(0.4, 0.38, 0.36) },
    { name: 'tower', data: cylinder(1.5, 8, 64), material: matte(0.7, 0.66, 0.6) },
  ]
  return { meshes, placed: scatter(count) }
}

/** One sphere of radius 1 m, 512 × 256: 261 120 triangles — the distance law's object. */
export const lawObject = (): SceneMesh => ({
  name: 'sphere',
  data: sphere([1, 1, 1], 512, 256),
  material: matte(0.7, 0.7, 0.72),
})
