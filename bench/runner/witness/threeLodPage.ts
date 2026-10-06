// The Three.js LEVEL-OF-DETAIL witness: the classic method from before clustered geometry.
// Each glTF mesh becomes a three-level `THREE.LOD` — the original, then two versions simplified
// on the fly by meshoptimizer (the bench's dev dependency, served under `/vendor/meshoptimizer/`)
// — and Three picks the level by distance, object by object. That is what a careful Three
// project does by hand; it is the marker between bare Three (everything, always) and the
// engine (by cluster).
//
// One rule, no named scene: a coarser level as soon as the object is less than `PIXELS[i]`
// pixels high on screen — distance is deduced from the object's radius, the image height and
// the pose field of view. A level that does not drop at least a quarter of the previous
// level's triangles is abandoned: simplification gave nothing on that mesh, and saying so
// is better than one more level that costs the same. Declared cost: the simplified silhouette
// diverges from the original (`ERROR` relative to the mesh size), which the capture shows.
import * as THREE from 'three'
import { MeshoptSimplifier } from 'meshoptimizer'
import { mesurerThree } from './threeMeasurePage.ts'
import type { MeasureViewOptions } from '../harness/measureOptions.ts'

/** Each level beyond the original: target triangle fraction, tolerated error (relative to
 *  mesh size), and on-screen height in pixels under which it replaces the previous one. */
const LEVELS = [
  { part: 0.25, error: 0.02, pixels: 200 },
  { part: 0.06, error: 0.08, pixels: 50 },
]
const GAIN_MINIMUM = 0.75

/** Geometry simplified to `part` of its triangles, or `null` if the gain is too small. */
function simplifier(geometry: THREE.BufferGeometry, part: number, error: number) {
  const positions = geometry.attributes.position.array as Float32Array
  const indices = geometry.index?.array
  if (!indices) return null
  const target = Math.max(3, Math.floor((indices.length * part) / 3) * 3)
  // meshoptimizer returns the index in the received type: a 16-bit mesh stays so at each level.
  const [nouveaux] = MeshoptSimplifier.simplify(indices as Uint32Array, positions, 3, target, error)
  if (nouveaux.length > indices.length * GAIN_MINIMUM) return null
  // Vertices stay those of the original, shared: only the index changes from one level to
  // the next. Bounds too: a subset of the same vertices fits in those the loader placed,
  // and Three does not have to recompute them on three million vertices per level.
  const g = new THREE.BufferGeometry()
  for (const [nom, attribut] of Object.entries(geometry.attributes)) g.setAttribute(nom, attribut)
  g.setIndex(new THREE.BufferAttribute(nouveaux, 1))
  g.boundingBox = geometry.boundingBox?.clone() ?? null
  g.boundingSphere = geometry.boundingSphere?.clone() ?? null
  return g
}

/** Levels of a geometry: the original, then each level simplified from the previous. */
function buildLevels(geometry: THREE.BufferGeometry) {
  const levels = [geometry]
  for (const { part, error } of LEVELS) {
    const g = simplifier(levels.at(-1) as THREE.BufferGeometry, part, error)
    if (!g) break
    levels.push(g)
  }
  return levels
}

/** Distance at which an object of radius `rayon` is `pixels` pixels high. */
const distancePour = (rayon: number, pixels: number, height: number, fov: number) =>
  (rayon * height) / (2 * pixels * Math.tan((fov * Math.PI) / 360))

/**
 * Replaces each indexed mesh of `root` with a `THREE.LOD` at its levels, same material,
 * same transform. Returns what the reading publishes: levels built and triangles per level.
 */
export async function detailLevels(root: THREE.Object3D, options: MeasureViewOptions) {
  await MeshoptSimplifier.ready
  const cache = new Map<THREE.BufferGeometry, THREE.BufferGeometry[]>()
  const height = options.height,
    fov = options.pose.fov
  const triangles = new Array(LEVELS.length + 1).fill(0)
  let objects = 0,
    withoutLevel = 0
  const maillages: THREE.Mesh[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && mesh.geometry?.index) maillages.push(mesh)
  })
  root.updateMatrixWorld(true)
  for (const mesh of maillages) {
    // A geometry shared by instances is simplified, and counted, only once.
    let levels = cache.get(mesh.geometry)
    if (!levels) {
      levels = buildLevels(mesh.geometry)
      cache.set(mesh.geometry, levels)
      levels.forEach((g, i) => (triangles[i] += (g.index?.count ?? 0) / 3))
    }
    if (levels.length === 1) {
      withoutLevel++
      continue
    }
    // The sphere the glTF loader placed from the accessor bounds, otherwise compute it;
    // world scale is read on the first matrix column, without decomposing.
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
    const e = mesh.matrixWorld.elements
    const rayon = (mesh.geometry.boundingSphere?.radius ?? 0) * Math.hypot(e[0], e[1], e[2])
    const lod = new THREE.LOD()
    lod.name = mesh.name
    lod.position.copy(mesh.position)
    lod.quaternion.copy(mesh.quaternion)
    lod.scale.copy(mesh.scale)
    levels.forEach((g, i) => {
      const level = new THREE.Mesh(g, mesh.material)
      level.frustumCulled = mesh.frustumCulled
      lod.addLevel(level, i === 0 ? 0 : distancePour(rayon, LEVELS[i - 1].pixels, height, fov))
    })
    mesh.parent!.add(lod)
    mesh.parent!.remove(mesh)
    objects++
  }
  return { lodObjets: objects, lodSansNiveau: withoutLevel, lodTrianglesParNiveau: triangles }
}

/** One view, one threshold (ignored: Three has no threshold), the capture. Same contract as `measureView`. */
export const measureView = (options: MeasureViewOptions) => mesurerThree(options, detailLevels)
