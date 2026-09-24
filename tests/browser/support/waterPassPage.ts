// Page side of the water-pass proof: the real WebGPU engine (`webgpuPagesBackend`), a real device,
// a real reread image. A transmissive tile in front of an opaque ground, or of nothing, rendered
// through the water pass and read at its centre; nothing internal is inspected.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import {
  VIEWPORT,
  batisseur,
  carre,
  cameraFace,
  engine,
  libere,
  type ScenePreparee,
} from './sharedSceneProof.ts';
import { difference, image } from './sceneImageProof.ts';
import { executerAppareil } from './deviceProof.ts';
import { BACKGROUND, CASES, GROUND, WATER, type WaterCase } from './waterPassCases.ts';
import type { BackendDiagnostic } from '../../../packages/sdk-browser/src/backend/types.ts';

function scene(pagine: boolean, kase: WaterCase): ScenePreparee {
  const bati = batisseur();
  const fond = G.mesh(
    carre(4),
    G.basicSurface({
      color: new G.Color(GROUND.color),
      side: G.DOUBLE_SIDE,
    }),
  );
  fond.name = 'fond';
  fond.position.set(kase.groundX, 0, -GROUND.depth);
  bati.source.add(fond);
  bati.ajoute(fond, 'exact-clusters', 4);
  const eau = G.mesh(
    carre(1),
    Object.assign(
      G.physicalSurface({
        color: new G.Color(WATER.tint),
        transparent: true,
        opacity: 1,
        side: G.DOUBLE_SIDE,
        roughness: 0.05,
      }),
      {
        transmission: kase.transmission,
        ior: WATER.ior,
        thickness: kase.thickness,
        attenuationDistance: WATER.attenuationDistance,
        attenuationColor: new G.Color(WATER.attenuationColor),
      },
    ),
  );
  eau.name = 'eau';
  bati.source.add(eau);
  bati.ajoute(eau, pagine ? 'clustered-blend' : 'shared-blend', 1);
  return bati.fini();
}

/** RGB read at the tile's centre. Bottom-left origin, like `capture`. */
function centre(pixels: Uint8Array): number[] {
  const [w, h] = VIEWPORT,
    i = ((h >> 1) * w + (w >> 1)) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

interface CaseResult {
  name: string;
  pagine: boolean;
  centre: number[];
  moved: number[];
  drawsFirst: number | null | undefined;
  drawsLast: number | null | undefined;
  heldLast: boolean | null | undefined;
}

/** One case: four frames of the same pose. The centre of each, the draws, and whether the last
 *  was held — a still scene must end with no work at all. */
async function cas(
  device: GPUDevice,
  pagine: boolean,
  kase: WaterCase,
  evenements: BackendDiagnostic[],
): Promise<CaseResult> {
  const s = scene(pagine, kase);
  const { backend, canvas } = engine(
    webgpuPagesBackend,
    s,
    device,
    (e: BackendDiagnostic) => evenements.push(e),
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
      const { pixels, metriques } = await image(backend, camera);
      frames.push({
        centre: centre(pixels),
        draws: metriques.transparentDrawCalls,
        held: metriques.frameHeld,
        moved: frames.length ? difference(frames[frames.length - 1].pixels, pixels) : 0,
        pixels,
      });
    }
    return {
      name: kase.name,
      pagine,
      centre: frames[0].centre,
      moved: frames.map((f) => f.moved),
      drawsFirst: frames[0].draws,
      drawsLast: frames[frames.length - 1].draws,
      heldLast: frames[frames.length - 1].held,
    };
  } finally {
    libere(backend, canvas, s);
  }
}

export function executer() {
  return executerAppareil<{ cases: CaseResult[] }>(async (device, evenements, resultat) => {
    const cases: CaseResult[] = (resultat.cases = []);
    for (const pagine of [false, true])
      for (const kase of CASES)
        cases.push(await cas(device, pagine, kase, evenements as BackendDiagnostic[]));
  });
}
