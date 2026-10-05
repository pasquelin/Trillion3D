// Page side of the default-backend proof on a machine without WebGPU: the world the engine opens
// on its own choice (`openDefaultWorld`), drawn once its pages are in, and read back — what the
// engine chose and mounted, the frame's counters, and how much of the image the scene covers.
import { openMeasuredWorld } from '../../../packages/sdk-browser/src/measurement/measurement.ts';
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts';
import { openDefaultWorld } from '../kit/defaultWorld.ts';
import { drawnPixels } from '../kit/sceneImageProof.ts';

export async function execute({
  manifestUrl,
  lights,
}: {
  manifestUrl: string;
  lights: SceneLight[];
}) {
  // A canvas of its own: one that once held a WebGPU context never hands out a WebGL2 one.
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:480px;height:320px;display:block';
  document.body.append(canvas);
  const { world, chosen } = await openDefaultWorld(openMeasuredWorld, canvas, manifestUrl, lights);
  try {
    // The frame's own counters: every triangle its cut selected is submitted on this one.
    const frame = world.render();
    await world.flush();
    const pixels = world.capture();
    return {
      ...chosen(),
      webgpu: 'gpu' in navigator && navigator.gpu !== undefined,
      selectedTriangles: frame.selectedTriangles,
      submittedTriangles: frame.submittedTriangles ?? null,
      drawn: drawnPixels(pixels),
      pixels: pixels.length / 4,
    };
  } finally {
    world.dispose();
    canvas.remove();
  }
}
