// The scene the temporal Hi-Z tests cut: quads of one surface at depths the pyramid separates, and
// the two viewports a depth buffer has to carry. Shared by `temporalLists.test.ts` (the lists the cut
// writes) and `temporalDepth.test.ts` (the depth it rasters into), which otherwise spelled the same
// scene twice. The camera they are seen from is `tests/fixtures/hiz.ts`, which poses it outside this
// package's pose boundary.
import * as G from '../host/graph/graph.fixture.ts'
import { locatedBy } from '../page/selection/placements.fixture.ts'
import { quad } from '../../../../tests/fixtures/hiz.ts'

/** A quad by its two corners in world space, `[minX, minY, minZ, maxX, maxY, maxZ]`. */
export type Corners = [number, number, number, number, number, number]

export type Scene = {
  pages: ReturnType<typeof quad>['page'][]
  locations: ReturnType<typeof locatedBy>
  dispose: () => void
}

/** One surface, one quad per box, every page placed by its own matrix — what the cut's occluder
 *  split and the stale regions both read. */
export function quadScene(boxes: Corners[]): Scene {
  const surface = G.basicSurface({ color: 0x3366ff })
  const made = boxes.map((box, i) => quad(surface, box.slice(0, 3), box.slice(3), `q${i}`))
  const pages = made.map((q) => q.page)
  return {
    pages,
    locations: locatedBy(pages.map((page) => ({ world: page.matrix }))),
    dispose: () => (made.forEach((q) => q.geometry.dispose()), surface.dispose()),
  }
}

export const narrowViewport = (): [number, number] => [16, 16]
export const wideViewport = (): [number, number] => [64, 64]

/** The locations of a sublist of a scene's pages: a cut of a narrower list places its own pages. */
export const subLocations = (scene: Scene, count: number) =>
  locatedBy(scene.pages.slice(0, count).map((page) => ({ world: page.matrix })))
