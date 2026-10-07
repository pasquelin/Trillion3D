// The scale laws' generated scenes, cooked by this checkout's native compiler as a published scene
// is: their glTF written under `.mesure/out/law-scenes/<key>/source/`, compiled with simplification
// into `cache/` beside it, once — a cache already there is reused. Delete the folder once the laws'
// numbers are reported, as every measurement output.
//   node bench/dawn/laws/cook.ts world <count> | object
// `world`: the open world of `count` objects (`scatter.ts`) on a ground as wide; `object`: one
// finely tessellated sphere, for the distance law. Prints the manifest's path.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileFullCache } from '../../../scripts/native-compiler.ts'
import { measureOutput } from '../../core/paths.ts'
import { sceneGltf, type SceneMesh, type SceneNode } from './gltf.ts'
import { cylinder, ground, sphere } from './meshes.ts'
import { scatter, sideOf } from './scatter.ts'

/** The folder of a law's scene. */
const lawScene = (key: string) => measureOutput('law-scenes', key)
/** Where a cooked scene's manifest lies. */
export const manifestOf = (key: string) =>
  join(lawScene(key), 'cache', 'native', 'full', 'manifest.json')

const matte = (r: number, g: number, b: number) => ({
  color: [r, g, b] as [number, number, number],
  roughness: 0.85,
  metalness: 0,
})

/** The open world of `count` objects: a ground reaching past them, pebbles, rocks and towers. */
function worldScene(count: number) {
  const side = sideOf(count) + 40
  const meshes: SceneMesh[] = [
    { name: 'ground', data: ground(side, 64), material: matte(0.42, 0.36, 0.27) },
    { name: 'pebble', data: sphere([0.15, 0.12, 0.15], 24, 16), material: matte(0.55, 0.53, 0.5) },
    { name: 'rock', data: sphere([0.9, 0.6, 0.8], 64, 40), material: matte(0.4, 0.38, 0.36) },
    { name: 'tower', data: cylinder(1.5, 8, 64), material: matte(0.7, 0.66, 0.6) },
  ]
  const placed = scatter(count)
  const nodes: SceneNode[] = [
    { mesh: 0 },
    ...placed.map((instances, k) => ({ mesh: k + 1, instances })),
  ]
  return { meshes, nodes }
}

/** One sphere of radius 1 m, 512 × 256: 261 120 triangles. */
function objectScene() {
  const meshes: SceneMesh[] = [
    { name: 'sphere', data: sphere([1, 1, 1], 512, 256), material: matte(0.7, 0.7, 0.72) },
  ]
  return { meshes, nodes: [{ mesh: 0, translation: [0, 1, 0] }] as SceneNode[] }
}

/** Writes and compiles the scene `key` once; returns its manifest. */
function cookScene(key: string, build: () => { meshes: SceneMesh[]; nodes: SceneNode[] }) {
  const manifest = manifestOf(key)
  if (existsSync(manifest)) return manifest
  const folder = lawScene(key)
  mkdirSync(join(folder, 'source'), { recursive: true })
  const { meshes, nodes } = build()
  const { json, bytes } = sceneGltf(meshes, nodes, 'scene.bin')
  writeFileSync(join(folder, 'source', 'scene.bin'), bytes)
  writeFileSync(join(folder, 'source', 'scene.gltf'), JSON.stringify(json))
  compileFullCache({
    cwd: folder,
    source: 'source/scene.gltf',
    threads: 4,
    ramMb: 4096,
    simplification: 'qem-endpoints',
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  return manifest
}

/** The scene a law's point reads: the world of `count` objects, or the object. */
export const cookPoint = (count: number | null) =>
  count === null
    ? cookScene('object', objectScene)
    : cookScene(`world-${count}`, () => worldScene(count))

if (import.meta.main) {
  const [what, count] = process.argv.slice(2)
  if (what !== 'world' && what !== 'object')
    throw new Error('usage: node bench/dawn/laws/cook.ts world <count> | object')
  console.log(cookPoint(what === 'world' ? Number(count) : null))
}
