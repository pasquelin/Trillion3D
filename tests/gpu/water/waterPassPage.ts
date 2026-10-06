// Page of the water-pass proof: the real WebGPU engine (`webgpuPagesBackend`), a real device, a
// real reread image. A transmissive tile in front of an opaque ground, or of nothing, rendered
// through the water pass and read at its centre; the encoded pass labels prove the intended path.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import {
  VIEWPORT,
  batisseur,
  square,
  cameraFace,
  engine,
  release,
  type ScenePreparee,
} from '../kit/sharedSceneProof.ts';
import { difference, image } from '../kit/sceneImageProof.ts';
import { runOnDevice } from '../kit/deviceProof.ts';
import {
  BACKGROUND,
  CASES,
  GROUND,
  WATER_ATTACHMENT_BYTES,
  waterSurface,
  type WaterCase,
} from './waterPassCases.ts';
import type { BackendDiagnostic } from '../../../packages/sdk-browser/src/backend/types.ts';
import {
  WATER_COMPOSITE_PASS,
  WATER_SURFACE_PASS,
} from '../../../packages/sdk-browser/src/webgpu/water/passLabels.ts';

function scene(paged: boolean, kase: WaterCase): ScenePreparee {
  const builder = batisseur();
  const ground = G.mesh(
    square(4),
    G.basicSurface({
      color: new G.Color(GROUND.color),
      side: G.DOUBLE_SIDE,
    }),
  );
  ground.name = 'ground';
  ground.position.set(kase.groundX, 0, -GROUND.depth);
  builder.source.add(ground);
  builder.add(ground, 'exact-clusters', 4);
  const water = G.mesh(square(1), waterSurface(kase.transmission, kase.thickness));
  water.name = 'water';
  builder.source.add(water);
  builder.add(water, paged ? 'clustered-blend' : 'shared-blend', 1);
  return builder.fini();
}

/** RGB read at the tile's centre. Bottom-left origin, like `capture`. */
function centre(pixels: Uint8Array): number[] {
  const [w, h] = VIEWPORT,
    i = ((h >> 1) * w + (w >> 1)) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

interface CaseResult {
  name: string;
  paged: boolean;
  centre: number[];
  moved: number[];
  drawsFirst: number | null | undefined;
  drawsLast: number | null | undefined;
  heldLast: boolean | null | undefined;
}

/** One case: four frames of the same pose. The centre of each, the draws, and whether the last
 *  was held — a still scene must end with no work at all. */
async function waterCase(
  device: GPUDevice,
  paged: boolean,
  kase: WaterCase,
  events: BackendDiagnostic[],
): Promise<CaseResult> {
  const labels = new Set<string>();
  const create = device.createCommandEncoder.bind(device);
  device.createCommandEncoder = (descriptor) => {
    const encoder = create(descriptor),
      begin = encoder.beginRenderPass.bind(encoder);
    encoder.beginRenderPass = (pass) => {
      labels.add(pass.label ?? '');
      return begin(pass);
    };
    return encoder;
  };
  const s = scene(paged, kase);
  const { backend, canvas } = engine(
    webgpuPagesBackend,
    s,
    device,
    (e: BackendDiagnostic) => events.push(e),
    { clearColor: BACKGROUND },
  );
  try {
    await backend.prepare();
    const camera = cameraFace();
    const frames: {
      centre: number[];
      draws: number | null | undefined;
      held: boolean | null | undefined;
      moved: number;
      pixels: Uint8Array;
    }[] = [];
    for (let i = 0; i < 4; i++) {
      const { pixels, metrics: metrics } = await image(backend, camera);
      frames.push({
        centre: centre(pixels),
        draws: metrics.transparentDrawCalls,
        held: metrics.frameHeld,
        moved: frames.length ? difference(frames[frames.length - 1].pixels, pixels) : 0,
        pixels,
      });
    }
    if (
      kase.transmission > 0 &&
      (!labels.has(WATER_SURFACE_PASS) || !labels.has(WATER_COMPOSITE_PASS))
    )
      throw new Error('Water proof did not encode the real water passes');
    if (events.some((e) => e.phase === 'water-pass-refused'))
      throw new Error('Water pass was refused');
    return {
      name: kase.name,
      paged,
      centre: frames[0].centre,
      moved: frames.map((f) => f.moved),
      drawsFirst: frames[0].draws,
      drawsLast: frames[frames.length - 1].draws,
      heldLast: frames[frames.length - 1].held,
    };
  } finally {
    device.createCommandEncoder = create;
    release(backend, canvas, s);
  }
}

/** Every case, unpaged then paged, on a device that grants the water stage its attachments. */
export function run() {
  return runOnDevice<{ cases: CaseResult[] }>(
    async (device, events, result) => {
      const cases: CaseResult[] = (result.cases = []);
      for (const paged of [false, true])
        for (const kase of CASES)
          cases.push(await waterCase(device, paged, kase, events as BackendDiagnostic[]));
    },
    { maxColorAttachmentBytesPerSample: WATER_ATTACHMENT_BYTES },
  );
}
