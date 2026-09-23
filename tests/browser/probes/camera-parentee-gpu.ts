// Correctness of a parented camera, on the GPU actually run.
//
// The page `cameraParenteeGpuPage.ts` is bundled by esbuild, served on a local origin and
// launched in Chromium with Playwright. Frame after frame, the engine's WebGPU selection is
// computed for the child camera of a host parent that is moved then rotated, then for the
// parentless camera of the same world pose. Selected pages must be identical; otherwise the
// script fails.
//
//   node tests/browser/probes/camera-parentee-gpu.ts
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from './pageWebgpu.ts';
import type { executer } from './cameraParenteeGpuPage.ts';

declare global {
  var cameraParentee: { executer: typeof executer };
}

const ici = dirname(fileURLToPath(import.meta.url));

const script = await empaquetePage(resolve(ici, 'cameraParenteeGpuPage.ts'), 'cameraParentee');
const erreursPage: string[] = [];
const resultat = await dansPageWebgpu(
  (pixelErrors: number[]) => globalThis.cameraParentee.executer(pixelErrors),
  [0, 3.5],
  { titre: 'Parented camera', script, erreursPage },
);
resultat.erreurs = [...(resultat.erreurs ?? []), ...erreursPage];

if (resultat.indisponible) throw new Error(resultat.indisponible);
if (!resultat.cas) throw new Error('GPU_RESULT_MISSING_CAS');
console.log(`adaptateur : ${resultat.adaptateur}`);
let ecarts = 0;
for (const { pixelError, avecParent, sansParent } of resultat.cas) {
  for (let i = 0; i < avecParent.length; i++) {
    const rig = JSON.stringify(avecParent[i]),
      plate = JSON.stringify(sansParent[i]);
    const egal = rig === plate;
    if (!egal) ecarts++;
    console.log(
      `pixelError ${pixelError} frame ${i}: ${egal ? 'identical' : 'DISCREPANCY'}  rig ${rig}` +
        (egal ? '' : `  parentless ${plate}`),
    );
  }
}
if (resultat.erreurs.length) console.log(`erreurs WebGPU : ${resultat.erreurs.join(' | ')}`);
console.log(`${ecarts} GPU frame(s) in discrepancy`);
if (ecarts || resultat.erreurs.length) process.exitCode = 1;
