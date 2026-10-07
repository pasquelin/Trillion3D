import * as G from '../../host/graph/graph.fixture.ts'
import { cameraSelectionUniforms } from '../core/selection.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { packDagSelection } from './selection.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'
import { frontCamera } from '../../page/selection/dag.fixture.ts'
import { packedWorldsToRenderOrigin } from './pack.fixture.ts'
import {
  clusterErrorPixels,
  maxStretch,
  multiplyMatrix4,
  transformAffinePoint,
} from '../../../../sdk-core/src/index.ts'
import { REQUEST_PRIORITY_SCALE } from './request.ts'

/**
 * Frontier-count scene, posed at FOUR DEPTHS: a single pose keeps only one detail stage, hence
 * one band, and order would be checked on nothing. Far away, the copies resolve to different
 * stages and the cut carries several bands at once — what a real scene does all the time.
 */
export function requestScene(threshold: number, feuilles = 4096, levels = 8) {
  const pages = scenePages(feuilles, levels)
  const poses = [0, 12, 30, 70].map((z) => new G.Matrix4().makeTranslation(0, 0, -z))
  const roots = sceneRoots(pages, poses, true)
  const packed = packDagSelection(roots)
  // Posed by the scene builder that owns camera poses, read through the contract.
  const cam = engineCamera(frontCamera(16, 200))
  const uni = cameraSelectionUniforms(cam, threshold, [1280, 720])
  // The ranking proof reads the SAME pose: the relative view of the render frame and the poses
  // brought into it. Giving them in absolute world under a relative view would compare two frames.
  packedWorldsToRenderOrigin(packed, roots, uni.cameraWorld)
  return { pages, packed, uni, cam, roots }
}

/**
 * The SUBSTITUTE's screen error of each packed page of `scene`, by the core formula
 * (`clusterErrorPixels`), of which `projected` (WGSL) is the proven mirror. Recomputed here, never
 * reread from a snapshot, which is what makes a proof of the published order non-circular. Each
 * pose's view is composed as the kernel composes it: on the matrices BROUGHT TO THE RENDER FRAME
 * (`packed.worlds`); the roots' absolute worlds under a relative view would put the whole scene
 * on the eye, and yield an infinite error for half the cut, in silence.
 */
export function substitutePixels({ pages, packed, cam, uni }: ReturnType<typeof requestScene>) {
  const focal = Math.max(uni.pixelScale[0], uni.pixelScale[1])
  const views = Array.from({ length: packed.worldCount }, (_, w) => {
    const view = new Float64Array(16)
    multiplyMatrix4(
      view,
      cam.viewRelative,
      Float64Array.from(packed.worlds.subarray(w * 16, w * 16 + 16)),
    )
    return { view, stretch: maxStretch(view as unknown as readonly number[]) }
  })
  const centre = new Float64Array(4)
  return (id: number) => {
    const page = pages[id % pages.length],
      { view, stretch } = views[Math.floor(id / pages.length)]
    const sphere = (page.parentError === null ? page.sphere : page.parentSphere) as number[]
    const band = page.parentError === null ? (page.lodError ?? 0) : page.parentError
    transformAffinePoint(centre, view, sphere[0], sphere[1], sphere[2])
    return clusterErrorPixels(
      band,
      stretch,
      centre[0],
      centre[1],
      centre[2],
      sphere[3],
      focal,
      cam.near,
    )
  }
}

/** One quantization step of the request priority: 2^(1/16), i.e. 4.43 %. */
export const REQUEST_STEP = 2 ** (1 / REQUEST_PRIORITY_SCALE)

/**
 * The first rank of `pixels`, a published order, that rises more than ONE step above the one
 * before it, or -1. Two reasons for the step, and not one more: between two requests of the same
 * step the order is indifferent — ties are not broken —, and the boundary between two steps is
 * floating, the kernel rounding in f32 what a proof recomputes in f64.
 */
export function orderFault(pixels: readonly number[]) {
  for (let i = 1; i < pixels.length; i++) if (pixels[i] > pixels[i - 1] * REQUEST_STEP) return i
  return -1
}
