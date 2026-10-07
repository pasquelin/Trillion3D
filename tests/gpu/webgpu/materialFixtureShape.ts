// The shape of a material fixture (`materialFixtures.ts`): the viewport it is drawn in, the one
// light of the lit fixtures, the renderers that draw it and what a fixture declares.
import type * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { VIEWPORT } from '../kit/sharedSceneProof.ts'
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts'

/** Side of the square viewport every fixture is rendered in, in pixels: `rgbAt` reads both
 *  images with this row stride, so a viewport that is not square would misread them silently. */
export const [SIZE] = VIEWPORT
if (VIEWPORT[1] !== SIZE)
  throw new Error(`material fixtures need a square viewport, got ${VIEWPORT}`)

/** The one declared light of the lit fixtures: a sun above and in front of the square. */
export const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [-0.3, -0.5, -0.8],
  color: [1, 1, 1],
  intensity: 2.5,
  castsShadow: false,
}

/** A renderer that draws a fixture: the witness renderer, or the engine. */
export type Renderer = 'witness' | 'webgpu'

/** The pair every fixture is read on: the engine against the witness. */
export const WITNESS_PAIR: readonly [Renderer, Renderer] = ['witness', 'webgpu']

export interface Fixture {
  name: string
  material: () => G.GraphSurface
  lit?: boolean
  points: number[][]
  difference: number[]
  reason: string
  back?: boolean
  /** Turn of the square about its horizontal axis, radians: a grazing view. */
  tilt?: number
  behind?: number
  tangents?: boolean
  /** Measured against its ground truth (#443, `groundTruth.ts`): the pixels over one level the
   *  engine may show there beyond the witness's — CONTRIBUTING's 0 px, 4 on a masked cut-out —,
   *  `null` when both gaps are only reported. */
  truth?: number | null
}
