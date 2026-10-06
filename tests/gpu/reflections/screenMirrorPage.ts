// The engine side of the screen mirror proof: each arrangement of the mirror (`screenMirrorScene.ts`)
// rendered sharp, at the mirror's transition roughness and rough, through four steps — the first
// image, a moved red source, an offscreen one, a resized view —, each held image read where the
// sources and their analytic reflections land.
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts';
import { runOnDevice as withDevice } from '../kit/deviceProof.ts';
import { colorAt as sampleColor } from '../kit/sceneImageProof.ts';
import { versApi } from '../kit/sharedSceneProof.ts';
import { mirrorScene, type MirrorOptions } from './screenMirrorScene.ts';
import { mirrorRenderer, MIRROR_SIZE } from './screenMirrorRender.ts';

export interface MirrorReading {
  stable: number;
  direct: number[][];
  reflected: number[][];
  old: number[];
}
export interface MirrorCase {
  options: MirrorOptions;
  sharp: MirrorReading[];
  transition: MirrorReading[];
  rough: MirrorReading[];
}

async function sequence(
  options: MirrorOptions,
  roughness: number,
  device: GPUDevice,
  events: unknown[],
): Promise<MirrorReading[]> {
  const rig = mirrorScene(options, roughness);
  const renderer = await mirrorRenderer(rig, device, events, options.bounce);
  const positions = rig.sources.map((source) => source.position.clone());
  const old = rig.reflected(positions[0]);
  const readings: MirrorReading[] = [];
  try {
    // Initial frame, moved red source after a held frame, then a screen-space miss. Green
    // stays in place: stale history, swapped colours and indiscriminate emission all fail.
    for (const [step, x] of [-0.65, -1.2, -20, -20].entries()) {
      const size = step === 3 ? MIRROR_SIZE + 64 : MIRROR_SIZE;
      if (step === 3) renderer.resize(size);
      if (x !== -0.65) {
        const source = rig.sources[0];
        positions[0].x = x;
        if (!renderer.backend.setTransform) throw new Error('setTransform unavailable');
        renderer.backend.setTransform(
          source.name,
          versApi(new Matrix4().makeTranslation(...positions[0].toArray())),
        );
      }
      const { pixels, stable } = await renderer.held();
      const sample = (point: typeof old) =>
        sampleColor(pixels, rig.camera, point.x, point.y, point.z, [size, size]);
      readings.push({
        stable,
        direct: positions.map(sample),
        reflected: positions.map((position) => sample(rig.reflected(position))),
        old: sample(old),
      });
    }
    return readings;
  } finally {
    renderer.dispose();
  }
}

export function run() {
  return withDevice<{ cases: MirrorCase[] }>(async (device, events, result) => {
    const cases: MirrorCase[] = (result.cases = []);
    const all: MirrorOptions[] = [];
    for (const arrangement of [0, 1])
      for (const transparent of [false, true])
        for (const ortho of [false, true]) all.push({ arrangement, transparent, ortho });
    all.push({ arrangement: 0, transparent: false, ortho: false, bounce: true });
    for (const options of all)
      cases.push({
        options,
        sharp: await sequence(options, 0, device, events),
        transition: await sequence(options, 0.0526, device, events),
        rough: await sequence(options, 1, device, events),
      });
  });
}
