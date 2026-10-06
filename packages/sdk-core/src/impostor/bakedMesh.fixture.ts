import type { ImpostorMesh } from '../contracts/impostor.ts'
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
