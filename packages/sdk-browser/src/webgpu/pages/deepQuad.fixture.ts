import { coarseQuadScene } from './testOccluder.fixture.ts'

/**
 * The coarse quad under one more root, `3`, of twice its error: the group of the root holds the
 * coarse page `2`, and the two leaves stream below it. The pool's floor — the root cover and the
 * pages its groups replace (`../../residency/minimumCapacity.ts`) — is two slots of four: a pool
 * at its floor draws the coarse page, never the root, and has no slot for the leaves.
 */
export function deepQuadScene(): ReturnType<typeof coarseQuadScene> {
  const fixture = coarseQuadScene()
  const [primitive] = fixture.metadata.primitives,
    [first, second, coarse] = primitive.pages
  const error = 2 * coarse.lodError!,
    sphere = coarse.sphere!
  const pages = [
    first,
    second,
    { ...coarse, parentError: error, parentSphere: sphere, group: 1 },
    { ...coarse, id: 3, url: '3', level: 2, lodError: error, source: 1 },
  ]
  const groups = [
    ...primitive.structure!.groups,
    { level: 2, error, sphere, children: [2], outputs: [3] },
  ]
  return {
    ...fixture,
    metadata: {
      ...fixture.metadata,
      primitives: [
        {
          ...primitive,
          pages: pages as typeof primitive.pages,
          structure: { version: 1, roots: [3], groups },
        },
      ],
    },
    indices: new Map([...fixture.indices, ['3', fixture.indices.get('2')!]]),
  }
}
