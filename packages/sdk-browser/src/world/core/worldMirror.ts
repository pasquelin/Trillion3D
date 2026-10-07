/** Resource meshes share geometry and material; placement rows retain animation owners.
 * Loaded models keep their graph. Resource instances use placement rows, including blends. */
import { numbered } from '../../host/graph/serial.ts'
import { isDrawnNode } from '../../host/graph/kinds.ts'
import { Group, type Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import type { PlacementRows } from '../../placement/rows.ts'
import { hostSurface, repaintHostSurface } from './worldSurface.ts'
import { HOST_MAPS, type HostTextures } from './worldTextures.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { GraphSurface } from '../../host/graph/surface.ts'
import type { GraphTexture } from '../../host/graph/texture.ts'
import type { Cut } from './worldCuts.ts'
import type { PosedTwin } from './worldPoses.ts'
import type { RepaintedEntry } from './worldMaterials.ts'
import type { AlphaChange } from '../../placement/engineSceneUpdates.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'

/** The geometry of drawn triangles, under the attribute names a mesh reads. A sprite's quad is
 *  bounded as its pages are (`runtimePrimitive.ts`): by the cube and ball of its radius about its
 *  origin, which hold it whichever way the rasters turn it. */
function hostGeometry(drawn: DrawnTriangles) {
  const geometry = new Geometry()
  geometry.setAttribute('position', new BufferAttribute(drawn.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(drawn.normals, 3))
  if (drawn.uvs) geometry.setAttribute('uv', new BufferAttribute(drawn.uvs, 2))
  if (drawn.colors) geometry.setAttribute('color', new BufferAttribute(drawn.colors, 4))
  const deformation = drawn.deformation
  if (deformation?.joints && deformation.weights) {
    geometry.setAttribute(
      'skinIndex',
      new BufferAttribute(deformation.joints, deformation.influences ?? 4),
    )
    geometry.setAttribute(
      'skinWeight',
      new BufferAttribute(deformation.weights, deformation.influences ?? 4),
    )
  }
  geometry.morphTargetsRelative = true
  geometry.morphAttributes.position =
    deformation?.targets.map((t) => new BufferAttribute(t.positions, 3)) ?? []
  geometry.morphAttributes.normal =
    deformation?.targets.map((t) => new BufferAttribute(t.normals, 3)) ?? []
  geometry.setIndex(new BufferAttribute(drawn.indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const radius = drawn.spriteRadius
  if (radius !== undefined) {
    geometry.boundingBox!.min.set(-radius, -radius, -radius)
    geometry.boundingBox!.max.set(radius, radius, radius)
    geometry.boundingSphere!.center.set(0, 0, 0)
    geometry.boundingSphere!.radius = radius
  }
  return geometry
}

/** How a session reads repainted surfaces again (`EngineSceneUpdates.refreshMaterials`). */
type Refresh = (values: boolean, alpha?: AlphaChange) => boolean

/** What the mirror is built from: the resources placed by rows, the models drawn whole, and the
 *  mesh rank each geometry resource was given in the session's manifest. */
type Placed = {
  cut: Cut
  material: Material
  rows: PlacementRows
  name: string
  /** Worn by cloths: drawn on both faces (`hostSurface`'s `sheet`); unsaid, as it declares. */
  twoSided?: boolean
}
type MirrorInput = {
  placed: readonly Placed[]
  models: readonly { node: Object3D; graph: Object3D }[]
  rankOf: (cut: Cut) => number
}

/** The host graph of a world's session, and the twins the world poses before a frame. */
export function buildWorldMirror(input: MirrorInput) {
  const root = new Group()
  const twins = new Map<Object3D, PosedTwin>()
  const associations = new Map<
    Object3D,
    { meshes: number; primitives: number; placements?: PlacementRows }
  >()
  const built: MirrorBuilt = { geometries: new Map(), surfaces: new Map(), textures: new Map() }
  /** Hangs the host mesh of a resource placed by rows; returns it with its association. */
  const place = ({ cut, material, rows, name, twoSided }: Placed) => {
    const mesh = meshOf(built, cut, material, twoSided)
    mesh.name = name
    const association = { meshes: input.rankOf(cut), primitives: 0, placements: rows }
    associations.set(mesh, association)
    root.add(mesh)
    return { node: mesh, association }
  }
  input.placed.forEach(place)
  for (const { node, graph } of input.models) {
    const twin = new Group()
    twin.add(graph)
    twin.name = node.name
    twin.matrixAutoUpdate = false
    twin.matrix.fromArray(node.matrixWorld.elements)
    root.add(twin)
    twins.set(node, twin)
  }
  const repaint = (painted: readonly RepaintedEntry[], refresh?: Refresh) =>
    repaintMirror(built, painted, refresh)
  /** The host geometry of `cut`, once placed: the vertices a dynamic resource rewrites (#573). */
  const geometryOf = (cut: Cut) => built.geometries.get(cut)
  return { root, twins, associations, repaint, geometryOf }
}

/** What a mirror built and shares between its host meshes: one geometry per resource, and one
 *  surface per material, and a second one when the material asks for vertex colours and is worn
 *  by geometries with and without them: the material decides (`material.vertexColors`), and a
 *  geometry with no colour has none to tint by. A third when it is worn by lines: the line
 *  surface is widened and lifted (`hostSurface`). A fourth when it is worn by a sprite: the
 *  sprite surface turns its quad to the camera. A fifth, and a sixth with vertex colours, when it
 *  is worn by cloths: drawn on both faces. */
type MirrorBuilt = {
  geometries: Map<Cut, Geometry>
  surfaces: Map<Material, GraphSurface[]>
  textures: HostTextures
}

/** The host mesh of `cut` worn with `material`: its geometry and surface shared. */
function meshOf(built: MirrorBuilt, cut: Cut, material: Material, twoSided = false) {
  const { geometries, surfaces } = built
  let geometry = geometries.get(cut)
  if (!geometry) geometries.set(cut, (geometry = hostGeometry(cut.drawn)))
  // A dynamic resource's vertices are rewritten in place: the engine reads them as floats.
  if (cut.dynamic) geometry.usage = 'dynamic'
  const tinted = !!material.vertexColors && !!cut.drawn.colors,
    reading = cut.drawn.lines
      ? 'lines'
      : cut.drawn.spriteRadius !== undefined
        ? 'sprite'
        : twoSided
          ? 'sheet'
          : 'faces'
  let worn = surfaces.get(material)
  if (!worn) surfaces.set(material, (worn = []))
  const rank =
    reading === 'lines' ? 2 : reading === 'sprite' ? 3 : (reading === 'sheet' ? 4 : 0) + +tinted
  const surface = (worn[rank] ??= hostSurface(material, tinted, built.textures, reading))
  return numbered(new Mesh(geometry, surface))
}

/** Writes the repainted entries into the host surfaces built for them, then has `refresh` —
 *  the open session, if any — read them again: once, with the surfaces whose alpha moved the
 *  same way, and once more, no value, for each other way (`AlphaChange`). False when the
 *  session cannot. */
function repaintMirror(
  { surfaces }: MirrorBuilt,
  painted: readonly RepaintedEntry[],
  refresh?: Refresh,
) {
  let written = false,
    values = false
  const moved = new Map<string, AlphaChange & { surfaces: GraphSurface[] }>()
  for (const { entry, alpha, values: wrote } of painted) {
    const worn = (surfaces.get(entry.material) ?? []).filter(
      (surface): surface is GraphSurface => !!surface,
    )
    for (const surface of worn) repaintHostSurface(surface, entry.material)
    if (!worn.length) continue
    written = true
    values ||= wrote
    if (!alpha) continue
    const way = `${alpha.from}>${alpha.to}`
    const change = moved.get(way)
    if (change) change.surfaces.push(...worn)
    else moved.set(way, { ...alpha, surfaces: worn })
  }
  if (!refresh || !written) return true
  const [first, ...others] = moved.values()
  return refresh(values, first) && others.every((alpha) => refresh(false, alpha))
}

/** Gives back the geometries, surfaces and textures a mirror built, each once however many
 *  host meshes share it; a loaded model's are kept. */
export function releaseWorldMirror(root: Object3D) {
  const released = new Set<object>()
  for (const twin of root.children) {
    if (!isDrawnNode(twin)) continue
    const { geometry, material } = twin
    const surface = material as GraphSurface
    for (const owned of [geometry, surface] as { dispose(): void }[])
      if (!released.has(owned)) {
        released.add(owned)
        owned.dispose()
        if (owned === surface)
          for (const field of HOST_MAPS) {
            const texture = surface[field] as GraphTexture | null | undefined
            if (texture && !released.has(texture)) {
              released.add(texture)
              texture.dispose()
            }
          }
      }
  }
}
