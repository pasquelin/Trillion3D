import type { ImpostorMesh, ImpostorSection } from '../contracts/impostor.ts'
import type { ImpostorSwitchInput } from './switch.ts'

/** Three empty atlas maps: the switch and the plan read their presence, never their levels. */
export const MAPS = {
  colourCoverage: { kind: 'coverage', levels: [] },
  normalDepth: { kind: 'data', levels: [] },
  orm: { kind: 'data', levels: [] },
}

/** A baked entry of twelve frames a side carrying `input`, the four numbers its switch reads. */
export const bakedMesh = (
  mesh: number,
  name: string,
  input: ImpostorSwitchInput,
  hemi = false,
): ImpostorMesh => ({
  mesh,
  sourceMesh: mesh,
  name,
  placements: 40,
  masked: true,
  rootTriangles: input.rootTriangles,
  radius: input.objectRadius,
  status: 'baked',
  coverage: input.coverage,
  hemi,
  frames: 12,
  frameSide: input.frameSide,
  atlasSide: 12 * input.frameSide,
  objectRadius: input.objectRadius,
  switchDepth: { texel: 0, triangles: 0 },
  maps: MAPS,
})

/** The switch numbers of a tree and of a bush, as the tests' forests bake them. */
export const TREE = { objectRadius: 4.2, rootTriangles: 2100, coverage: 0.43, frameSide: 128 }
export const BUSH = { objectRadius: 0.6, rootTriangles: 460, coverage: 0.66, frameSide: 64 }

/** A section of two baked meshes: 1 the tree, 2 the bush on a hemisphere. */
export const TREE_AND_BUSH: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: 1117,
  textureLimit: 8192,
  baked: 2,
  refused: 0,
  meshes: [bakedMesh(1, 'tree', TREE), bakedMesh(2, 'bush', BUSH, true)],
}

/** A world turned by `angle` about y, scaled by `s`, at `(x, y, z)`, column-major. */
export const placed = (x: number, y: number, z: number, angle: number, s: number) => {
  const c = Math.cos(angle) * s,
    n = Math.sin(angle) * s
  return [c, 0, -n, 0, 0, s, 0, 0, n, 0, c, 0, x, y, z, 1]
}
