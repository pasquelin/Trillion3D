/** A node of the page's scene as far as counting triangles goes. */
export interface StatsSceneNode {
  visible?: boolean
  /** What the geometry draws: `triangles` for a mesh, points or lines otherwise. */
  primitive?: string
  traverseVisible?(visit: (node: StatsSceneNode) => void): void
  geometry?: {
    index?: { count: number } | null
    attributes?: { position?: { count: number } }
  } | null
}

/** Triangles of the visible meshes built in the scene: indexed, or three vertices each. Points and
 *  lines draw no triangle. */
export function sceneTriangles(scene: StatsSceneNode): number {
  let total = 0
  scene.traverseVisible?.((node) => {
    const shape = node.geometry
    if (shape && (node.primitive ?? 'triangles') === 'triangles')
      total += Math.floor((shape.index?.count ?? shape.attributes?.position?.count ?? 0) / 3)
  })
  return total
}
