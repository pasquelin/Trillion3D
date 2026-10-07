// The impostor plan reads, each image, the roots the cut may ask pages of — in the camera's view
// and in the view ahead a moving camera also cuts — and gives them their card bit. Read through the
// camera's frustum alone, a root entering the view ahead kept no card there and the cut asked its
// pages: more requests every image, each closed over by the row sync. On a generated field, the
// ids a readback hands the row sync — drawn, asked, asked ahead — are those of the plan of every
// root, image after image, still or turning.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera, placementField } from '../../gpu/dag/placementTree.fixture.ts'
import { packDagSelection } from '../../gpu/dag/selection.ts'
import { packedWorldsToRenderOrigin } from '../../gpu/dag/pack.fixture.ts'
import { evaluateDagSelectionKernel } from '../../gpu/dag/oracle/oracle.fixture.ts'
import { visitPlacements } from '../../gpu/dag/placementTree.ts'
import { cameraSelectionUniforms } from '../../gpu/core/selection.ts'
import { cutViewPlanes } from '../../gpu/core/aheadView.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { CARD_ROOT } from '../../visibility/shader/spriteWgsl.ts'
import type { CameraMotion } from '../../camera/motion.ts'

const VIEWPORT: [number, number] = [1280, 720]
/** Past this distance from the eye a placement draws its card: the plan's verdict, made simple. */
const FAR = 40

test('the ids a readback hands the row sync are those of the plan of every root, still or turning', () => {
  const roots = placementField(40, 6),
    centre = [117, 0, -117]
  const packed = packDagSelection(roots),
    tree = packed.placementTree!
  /** The card bits the plan of some ranks leaves: each rank read takes its verdict, any other
   *  keeps the one it had. */
  const kept = new Uint32Array(roots.length),
    planes = new Float64Array(24)
  const lists = (marks: Uint32Array, uniforms: ReturnType<typeof cameraSelectionUniforms>) => {
    packed.mark.set(marks)
    const cut = evaluateDagSelectionKernel(packed, uniforms)
    return [cut.drawablePageIds?.length, cut.pageIds.length, cut.aheadPageIds?.length ?? 0]
  }
  for (const orbit of [false, true]) {
    // A fresh plan: no rank read yet, none carded.
    kept.fill(0)
    for (let frame = 0; frame < 12; frame++) {
      const a = orbit ? (frame / 12) * 2 * Math.PI : 0
      // An eye amid the field, turning in place: near placements whole, far ones carded.
      const eye = [centre[0], 4, centre[2]],
        at = [centre[0] + 100 * Math.sin(a), 0, centre[2] - 100 * Math.cos(a)]
      const cam = engineCamera(fieldCamera(eye, at, 400))
      // The turn's motion: the view turning about the vertical, which the view ahead leads.
      const motion: CameraMotion = orbit
        ? {
            velocity: Float64Array.of(0, 0, 0),
            ...{ turn: 1, axis: Float64Array.of(0, 1, 0), steadyMs: 1e3, turnSteadyMs: 1e3 },
          }
        : {}
      const uniforms = cameraSelectionUniforms(cam, 1, VIEWPORT, undefined, motion)
      packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld)
      const far = (w: number) => {
        const t = roots[w].world.elements
        return Math.hypot(t[12] - eye[0], t[13] - eye[1], t[14] - eye[2]) > FAR ? CARD_ROOT : 0
      }
      const every = Uint32Array.from(roots, (_, w) => far(w))
      visitPlacements(packed, tree, cutViewPlanes(cam, motion, planes), (w) => (kept[w] = far(w)))
      assert.deepEqual(
        lists(kept, uniforms),
        lists(every, uniforms),
        `${orbit ? 'turning' : 'still'} ${frame}`,
      )
    }
  }
})
