// The generated scene the glass, memory and dispose proofs share: an opaque blue backdrop filling
// the view, and what stands before it — a clear glass (a blend with water), a polished metal
// mirror, an opaque red tile —, each lit square a plane that carries its normals.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { batisseur } from './sharedSceneProof.ts'

/** What stands before the backdrop: the glass, its centre at `at` on `x`, with a red volume that
 *  stops blue within a few hundredths of a unit when `volume`; the mirror; the tile in front. */
export interface Backdrop {
  glass?: { at?: number; volume?: boolean }
  mirror?: boolean
  tile?: boolean
}

/** A clear glass: fully transmissive, index 1.5, half a unit thick. */
const glass = (volume: boolean) =>
  G.physicalSurface({
    ...{ color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, ior: 1.5 },
    ...{ thickness: 0.5, transparent: true, side: G.DOUBLE_SIDE },
    ...(volume ? { attenuationColor: 0xff0000, attenuationDistance: 0.05 } : {}),
  })

export function backdropScene({ glass: placed, mirror, tile }: Backdrop = {}) {
  const builder = batisseur()
  const lit = (half: number) => G.planeGeometry(2 * half, 2 * half)
  const place = (surface: G.GraphSurface, pass: string, half: number, x: number, z: number) =>
    builder.place(surface, pass, half, [x, 0, z], {}, lit(half))
  place(G.basicSurface({ color: 0x2244aa, side: G.DOUBLE_SIDE }), 'exact-clusters', 4, 0, -1)
  if (placed) place(glass(!!placed.volume), 'clustered-blend', 0.8, placed.at ?? 0, 0)
  if (mirror)
    place(
      G.standardSurface({ color: 0xffffff, metalness: 1, roughness: 0.04, side: G.DOUBLE_SIDE }),
      'exact-clusters',
      0.8,
      0,
      0,
    )
  if (tile) place(G.basicSurface({ color: 0xcc2222 }), 'exact-clusters', 0.25, 0, 0.5)
  return builder.fini()
}
