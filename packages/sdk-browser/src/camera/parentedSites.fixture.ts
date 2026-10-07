// The engine sites that read a camera pose, each called by its real code, for the parented-camera
// test (`parented.test.ts`). A site is `{ name, create, measure }`: `create()` returns the state
// of a frame sequence (Hi-Z history, cut, engine), `measure(state, camera)` returns, ready to be
// JSON-stringified, what the site took from the camera for that frame.
import { surfaceOf } from '../page/surface.ts'
import * as G from '../host/graph/graph.fixture.ts'
import { cameraSelectionUniforms } from '../gpu/core/selection.ts'
import { collectClusterPages } from '../page/selection/selection.ts'
import { selectVisiblePages } from '../page/cut/cut.fixture.ts'
import { boundsFor, projectBoxesFlat } from '../hiz/projection.ts'
import { sameHizView } from '../hiz/temporal.ts'
import { visibilityDepth } from '../hiz/visibilityDepth.fixture.ts'
import { shadeVisibility } from '../../../../bench/oracles/browser/cpu-image/shade.ts'
import type { VisPage } from '../visibility/types.ts'
import type { HizPage } from '../hiz/types.ts'
import { projectedPageError } from '../page/selection/diagnostic.ts'
import { resolvePixelError } from '../page/selection/requests.ts'
import type { CameraMotion } from './world.ts'
import { dagFixture } from '../page/selection/dag.fixture.ts'
import { engineSites, type Site } from './parentedEngineSites.fixture.ts'
import {
  createEngineCamera,
  holdCameraWorld,
  readCameraWorld,
  type EngineCamera,
  type HostCamera,
} from './world.ts'
import { identityRoots } from '../page/selection/placements.fixture.ts'
import { rasterVisibility } from '../../../../bench/oracles/browser/cpu-image/raster.ts'

const VIEWPORT: [number, number] = [1280, 720],
  RASTER: [number, number] = [64, 36]
const list = (values: ArrayLike<number>): number[] => Array.from(values)
/** What a frame input does: the host camera copied into the engine's. Each site remakes it for
 *  itself, like a lone caller. */
const engine = (camera: HostCamera) => readCameraWorld(createEngineCamera(), camera)

/** A page as the Hi-Z and visbuffer sites both need it. */
type VisHizPage = VisPage & HizPage

/** Pages of the test DAG, in the shape the cut, Hi-Z and rasters read. */
function dagPages(): { roots: ReturnType<typeof collectClusterPages>['roots']; vis: VisHizPage[] } {
  const fixture = dagFixture()
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  )
  // Dark and metallic: the specular, the only term that reads eye position, stays under 255.
  const material = G.standardSurface({
    color: 0x303030,
    metalness: 0.9,
    roughness: 0.35,
    side: G.DOUBLE_SIDE,
  })
  const vis: VisHizPage[] = [0, 1, 2, 3].map((t) => ({
    array: new Uint32Array([t * 3, t * 3 + 1, t * 3 + 2]),
    attributes: fixture.geometry.attributes,
    material: surfaceOf(material),
    min: [-2 + t, -0.5, 0],
    max: [-1 + t, 0.5, 0],
  }))
  return { roots, vis }
}

/** Pure sites: none keep state from one frame to the next, except held rectangles. */
const pureSites: Site[] = [
  {
    name: 'cameraSelectionUniforms (GPU selection)',
    measure: (_state, camera: HostCamera) => {
      const u = cameraSelectionUniforms(engine(camera), 1, VIEWPORT)
      return {
        view: list(u.view),
        planes: list(u.planes),
        cameraWorld: u.cameraWorld,
        cameraStretch: u.cameraStretch,
      }
    },
  },
  {
    name: 'selectVisiblePages (CPU cut)',
    create: dagPages,
    measure: (state, camera: HostCamera) => {
      const { roots } = state as ReturnType<typeof dagPages>
      return [0, 3.5].map((pixelError) => {
        const cut = selectVisiblePages(roots, engine(camera), { pixelError, viewport: VIEWPORT })
        return { shown: cut.shown.map((p) => p.url).sort(), rejected: cut.frustumRejected }
      })
    },
  },
  {
    name: 'projectBoxesFlat (Hi-Z, rectangles)',
    create: dagPages,
    measure: (state, camera: HostCamera) => {
      const { vis } = state as ReturnType<typeof dagPages>
      const bounds = boundsFor(vis.length)
      projectBoxesFlat(vis, identityRoots(), vis.length, engine(camera), VIEWPORT, bounds)
      return list(bounds)
    },
  },
  {
    // The view the occluder history follows, held as the frame holds it (`hizViewMoved`): the
    // move is read against the last frame's, and reread at once the held view is equal.
    name: 'holdCameraWorld + sameHizView (occluder history view)',
    create: () => ({ held: undefined as EngineCamera | undefined }),
    measure: (state, camera: HostCamera) => {
      const history = state as { held: EngineCamera | undefined }
      const view = engine(camera),
        moved = !sameHizView(history.held, view)
      history.held = holdCameraWorld(history.held ?? createEngineCamera(), view)
      return { moved, sameHistory: sameHizView(history.held, view) }
    },
  },
  {
    name: 'rasterVisibility + visibilityDepth + shadeVisibility (lit CPU raster)',
    create: dagPages,
    measure: (state, camera: HostCamera) => {
      const { vis } = state as ReturnType<typeof dagPages>
      const view = engine(camera)
      const { ids } = rasterVisibility(vis, identityRoots(), view, RASTER)
      const depth = visibilityDepth(ids, vis, identityRoots(), view, RASTER)
      const rgba = shadeVisibility(ids, vis, identityRoots(), view, RASTER)
      return { ids: list(ids), depth: list(depth), rgba: list(rgba) }
    },
  },
  {
    name: 'projectedPageError (error diagnostic)',
    measure: (_state, camera: HostCamera) =>
      projectedPageError(
        { lodError: 0.05, sphere: [0.5, 0, 0, 0.6] },
        new G.Matrix4(),
        engine(camera),
        VIEWPORT,
      ),
  },
  {
    name: 'resolvePixelError (camera speed)',
    // Called by every engine just after updating the frame camera: same contract here.
    create: () => ({ motion: {} as CameraMotion }),
    measure: (state, camera: HostCamera) => {
      const { motion } = state as { motion: CameraMotion }
      resolvePixelError({ pixelError: 1, lodAdaptive: true }, engine(camera), motion)
      return list(motion.last ?? [])
    },
  },
]

export const SITES: Site[] = [...pureSites, ...engineSites]

/** A world point run through a column-major 4×4 matrix. */
const apply = (m: ArrayLike<number>, [x, y, z]: number[]): number[] => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

/**
 * Residual of render-frame composition. Selection uniforms publish a view WITHOUT translation
 * and the eye world position, which is the origin of that frame: all translation is passed into
 * world matrices, which the engine brings back to this origin. Applying the relative view to a
 * point so brought back must yield, to single-precision rounding, what the absolute view yields
 * of the same point. Non-zero as soon as the published position is not that of the view — an
 * unwalked rig, for example: it is now what carries the camera move.
 */
export function renderFrameResidual(camera: HostCamera): number {
  const cam = engine(camera),
    u = cameraSelectionUniforms(cam, 1, VIEWPORT)
  const probe = [12, -7, 31]
  const brought = probe.map((value, i) => value - u.cameraWorld[i])
  const absolute = apply(cam.view, probe),
    relative = apply(u.view, brought)
  return Math.hypot(absolute[0] - relative[0], absolute[1] - relative[1], absolute[2] - relative[2])
}
