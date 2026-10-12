// The generated scene the memory proofs share: an opaque blue backdrop filling the view, and what
// stands before it — nothing, a clear glass (a blend with water), or a polished metal mirror; and
// the lit plane and the backdrop the scene proofs build theirs with.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { batisseur, square } from './sharedSceneProof.ts'

export function backdropScene(front: 'none' | 'glass' | 'mirror' = 'none') {
  const builder = batisseur()
  const add = (surface: G.GraphSurface, pass: string, z: number, half: number) =>
    addPlane(builder, surface, pass, z, half)
  add(G.basicSurface({ color: 0x2244aa, side: G.DOUBLE_SIDE }), 'exact-clusters', -1, 4)
  if (front === 'glass')
    add(
      G.physicalSurface({
        ...{ color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, ior: 1.5 },
        ...{ thickness: 0.5, transparent: true, side: G.DOUBLE_SIDE },
      }),
      'clustered-blend',
      0,
      0.8,
    )
  if (front === 'mirror')
    add(
      G.standardSurface({ color: 0xffffff, metalness: 1, roughness: 0.04, side: G.DOUBLE_SIDE }),
      'exact-clusters',
      0,
      0.8,
    )
  return builder.fini()
}

/** A lit square of half side `half` added to `builder` on `pass`, facing +z at depth `z`, its
 *  centre on `x`: the plane of the graph, which carries its normals, not the proofs' bare square. */
export function addPlane(
  builder: ReturnType<typeof batisseur>,
  surface: G.GraphSurface,
  pass: string,
  z: number,
  half: number,
  x = 0,
) {
  const mesh = G.mesh(G.planeGeometry(2 * half, 2 * half), surface)
  mesh.position.set(x, 0, z)
  builder.source.add(mesh)
  builder.add(mesh, pass, half)
  return mesh
}

/** The proofs' blue backdrop, added to `builder`: a 4 m square named `background` two metres
 *  behind the origin, drawn exact, its surface on `side` when one is given. */
export function addBackdrop(builder: ReturnType<typeof batisseur>, side?: number) {
  const background = G.mesh(
    square(4),
    G.basicSurface(side === undefined ? { color: 0x1b3a5c } : { color: 0x1b3a5c, side }),
  )
  background.name = 'background'
  background.position.z = -2
  builder.source.add(background)
  builder.add(background, 'exact-clusters', 4)
  return background
}
