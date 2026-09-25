// Page side of the ground truth (#443): a fixture that declares `truth` is cast again on the CPU
// (`groundTruth.ts`) from its own map, square and camera, and both renderers' images are measured
// against it. The truth image joins theirs, for the measurer to look at.
//
// This module is SERVED to the harness page and imported by its URL, like the fixtures.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { groundTruth, truthGap, type TruthGap } from './groundTruth.ts';
import { SIZE, type Fixture } from './materialFixtureShape.ts';
import { BEHIND, CLEAR_COLOR, SQUARE_SIDE } from './materialPixelsRender.ts';

/** Both renderers' gaps to the truth, and the pixels the engine may show over one level — `null`
 *  when the gaps are only reported. */
export interface TruthReading {
  tolerance: number | null;
  reference: TruthGap;
  engine: TruthGap;
}

/** A bottom-left RGBA8 image as a PNG, rows put top first as a canvas holds them. */
function pictureOf(rgba: Uint8Array) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const image = new ImageData(SIZE, SIZE),
    row = SIZE * 4;
  for (let y = 0; y < SIZE; y++)
    image.data.set(rgba.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), y * row);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/** The fixture's truth and both gaps to it, or nothing when it declares no truth: its map, a
 *  canvas (`materialImages.ts`), on the squares `sceneOf` places. */
export function truthOf(
  fixture: Fixture,
  camera: G.GraphCamera,
  reference: ArrayLike<number>,
  engine: ArrayLike<number>,
): { reading: TruthReading; images: { truth: string } } | undefined {
  if (fixture.truth === undefined) return;
  const surface = fixture.material(),
    map = surface.map as G.GraphTexture,
    canvas = map.image as HTMLCanvasElement;
  if (
    fixture.lit ||
    fixture.back ||
    surface.family !== 'basic' ||
    (surface.color as G.Color).getHex() !== 0xffffff ||
    map.flipY ||
    map.magFilter !== G.HOST_FILTER_LINEAR ||
    map.wrapS !== G.HOST_WRAP_REPEAT ||
    map.wrapT !== G.HOST_WRAP_REPEAT
  )
    throw new Error(
      `${fixture.name}: the ground truth reads a white unlit front face wearing an unflipped, ` +
        'repeated, bilinear map',
    );
  map.updateMatrix();
  const truth = groundTruth({
    size: SIZE,
    camera,
    square: { place: new G.Matrix4().makeRotationX(fixture.tilt ?? 0), half: SQUARE_SIDE / 2 },
    map: {
      data: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width,
      height: canvas.height,
      srgb: map.colorSpace === G.HOST_COLOUR_SPACE_SRGB,
      uv: map.matrix.elements,
    },
    alphaTest: surface.alphaTest,
    behind:
      fixture.behind === undefined
        ? undefined
        : {
            place: new G.Matrix4().makeTranslation(0, 0, BEHIND.z),
            half: BEHIND.side / 2,
            colour: fixture.behind,
          },
    clear: CLEAR_COLOR,
  });
  surface.dispose();
  return {
    reading: {
      tolerance: fixture.truth,
      reference: truthGap(reference, truth),
      engine: truthGap(engine, truth),
    },
    images: { truth: pictureOf(truth.rgba) },
  };
}
