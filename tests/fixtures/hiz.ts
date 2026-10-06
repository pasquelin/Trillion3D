import { surfaceOf } from '../../packages/sdk-browser/src/page/surface.ts'
import * as G from '../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import type { VisPage } from '../../packages/sdk-browser/src/visibility/buffer.ts'
import { engineCamera } from '../../packages/sdk-browser/src/camera/camera.fixture.ts'
import type { EngineCamera } from '../../packages/sdk-browser/src/camera/world.ts'
import { identityLocations } from '../../packages/sdk-browser/src/page/selection/placements.fixture.ts'
import type { HizPage } from '../../packages/sdk-browser/src/hiz/types.ts'
import type { HizBounds } from '../../bench/oracles/browser/hizRejects.ts'
import { buildHizPyramid } from '../../packages/sdk-browser/src/hiz/depth.ts'
import { visibilityDepth } from '../../packages/sdk-browser/src/hiz/visibilityDepth.fixture.ts'
import { HIZ_BOUNDS_VALUES } from '../../packages/sdk-browser/src/hiz/corners.ts'
import { projectBoxesFlat } from '../../packages/sdk-browser/src/hiz/projection.ts'
import { rasterVisibilityIds } from '../../bench/oracles/browser/cpu-image/raster.ts'

export function cameraAt(z = 5, near = 0.1) {
  const cam = G.perspectiveCamera(55, 1, near, 100)
  cam.position.z = z
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return cam
}

export function quad(
  material: G.GraphSurface,
  min: number[],
  max: number[],
  clusterId: string,
): { page: VisPage & HizPage & { matrix: G.Matrix4 }; geometry: G.Geometry } {
  const z = (min[2] + max[2]) * 0.5
  const geometry = new G.Geometry()
  geometry.setAttribute(
    'position',
    G.floatAttribute(
      [min[0], min[1], z, max[0], min[1], z, max[0], max[1], z, min[0], max[1], z],
      3,
    ),
  )
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3]))
  // Rank 0 of the identity root; the oracles read that world on the page, as pages carried it.
  const page = {
    array: new Uint32Array([0, 1, 2, 0, 2, 3]),
    attributes: geometry.attributes,
    matrix: new G.Matrix4(),
    material: surfaceOf(material),
    clusterId,
    min,
    max,
    url: clusterId,
  }
  return { page, geometry }
}

const boxScratch = new Float64Array(HIZ_BOUNDS_VALUES)
/**
 * Single-box `HizBounds` adapter over the flat, batched `projectBoxesFlat`: `projectBoxToScreen`
 * was removed when the pipeline moved to the flat layout, but tests written for one box at a time
 * still want that shape. This calls the real (only) projection with a batch of one.
 */
export function projectBoxToScreen(
  min: number[],
  max: number[],
  matrix: G.Matrix4,
  camera: G.Camera | EngineCamera,
  viewport: [number, number],
): HizBounds {
  projectBoxesFlat(
    [{ min, max }],
    { roots: [{ world: matrix }], packed: [0], rootOfPacked: Int32Array.from([0]) },
    1,
    engineCamera(camera),
    viewport,
    boxScratch,
  )
  return {
    minX: boxScratch[0],
    minY: boxScratch[1],
    maxX: boxScratch[2],
    maxY: boxScratch[3],
    nearestDepth: boxScratch[4],
    clipsNear: boxScratch[5] !== 0,
  }
}

/** The Hi-Z pyramid of the depth `occluders`, placed at the identity, leave as `cam` sees them. */
export function occluderPyramid(occluders: VisPage[], cam: EngineCamera, size: [number, number]) {
  const locations = identityLocations(occluders.length)
  const ids = rasterVisibilityIds(occluders, locations, cam, size)
  return buildHizPyramid(visibilityDepth(ids, occluders, locations, cam, size), ...size)
}

/** A small deterministic generator in [0, 1): the same seed gives the same generated cases. */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}
