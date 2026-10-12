// The generated scene the memory proofs share: an opaque blue backdrop filling the view, and what
// stands before it — nothing, a clear glass (a blend with water), or a polished metal mirror.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { batisseur } from './sharedSceneProof.ts'

export function backdropScene(front: 'none' | 'glass' | 'mirror' = 'none') {
  const builder = batisseur()
  const add = (surface: G.GraphSurface, pass: string, z: number, half: number) => {
    const mesh = G.mesh(G.planeGeometry(2 * half, 2 * half), surface)
    mesh.position.set(0, 0, z)
    builder.source.add(mesh)
    builder.add(mesh, pass, half)
  }
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
