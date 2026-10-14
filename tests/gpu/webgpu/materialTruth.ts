// Page side of the ground truth: a fixture that declares `truth` is cast again on the CPU
// (`groundTruth.ts`) from its own map, square and camera, and both renderers' images are measured
// against it.
import type { Camera } from '../../../packages/sdk-core/src/world/camera/camera.ts'
import type { Texture } from '../../../packages/sdk-core/src/world/texture/texture.ts'
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts'
import { groundTruth, truthGap, type TruthGap } from './groundTruth.ts'
import { SIZE, type Fixture } from './materialFixtureShape.ts'
import { BEHIND, CLEAR_COLOR, SQUARE_SIDE } from './materialPixelsRender.ts'

/** Both renderers' gaps to the truth, and the pixels the engine may show over one level — `null`
 *  when the gaps are only reported. */
export interface TruthReading {
  tolerance: number | null
  reference: TruthGap
  engine: TruthGap
}

/** The fixture's truth and both gaps to it, or nothing when it declares no truth: its map, a
 *  canvas (`materialImages.ts`), on the squares `sceneOf` places. */
export function truthOf(
  fixture: Fixture,
  camera: Camera,
  reference: ArrayLike<number>,
  engine: ArrayLike<number>,
): TruthReading | undefined {
  if (fixture.truth === undefined || engine.length === 0) return // no frame: `held` names it
  const surface = fixture.material(),
    map = surface.map as Texture | null
  if (
    !map ||
    fixture.lit ||
    fixture.back ||
    surface.transparent ||
    surface.family !== 'basic' ||
    surface.baseColor.some((channel) => channel !== 1) ||
    map.flipY ||
    map.magFilter !== 'linear' ||
    map.wrapS !== 'repeat' ||
    map.wrapT !== 'repeat'
  )
    throw new Error(
      `${fixture.name}: the ground truth reads an opaque white unlit front face wearing an ` +
        'unflipped, repeated, bilinear map',
    )
  const canvas = map.image as HTMLCanvasElement
  const truth = groundTruth({
    size: SIZE,
    camera,
    square: { place: new Matrix4().makeRotationX(fixture.tilt ?? 0), half: SQUARE_SIDE / 2 },
    map: {
      data: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width,
      height: canvas.height,
      srgb: map.colorSpace === 'srgb',
      uv: map.transform,
    },
    alphaTest: surface.alphaTest,
    behind:
      fixture.behind === undefined
        ? undefined
        : {
            place: new Matrix4().makeTranslation(0, 0, BEHIND.z),
            half: BEHIND.side / 2,
            colour: fixture.behind,
          },
    clear: CLEAR_COLOR,
  })
  surface.dispose()
  return {
    tolerance: fixture.truth,
    reference: truthGap(reference, truth),
    engine: truthGap(engine, truth),
  }
}
