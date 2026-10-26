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
function sceneTriangles(scene: StatsSceneNode): number {
  let total = 0
  scene.traverseVisible?.((node) => {
    const shape = node.geometry
    if (shape && (node.primitive ?? 'triangles') === 'triangles')
      total += Math.floor((shape.index?.count ?? shape.attributes?.position?.count ?? 0) / 3)
  })
  return total
}

/** What the collector counts the scene's triangles with: at most once a second, and only when an
 *  image was drawn since the last count. */
export function sceneCounter(
  scene: () => StatsSceneNode | undefined,
  wanted: boolean,
  periodMs: number,
) {
  let frames = 0,
    countedAt = -1,
    countedTime = Number.NEGATIVE_INFINITY,
    count: number | null = null
  return {
    /** An image was drawn. */
    frame: () => frames++,
    /** Counts when due: `selected` is the frame's own selected triangles (no count then). */
    update(now: number, selected: number | null | undefined) {
      const node = scene()
      if (
        !wanted ||
        selected != null ||
        !node ||
        countedAt === frames ||
        now - countedTime < periodMs
      )
        return
      count = sceneTriangles(node) || null
      countedAt = frames
      countedTime = now
    },
    count: () => count,
  }
}
