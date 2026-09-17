// Justesse d'une caméra parentée, côté GPU réellement exécuté.
//
// La page `cameraParenteeGpuPage.mjs` est empaquetée par esbuild (celui de Vite, pris dans
// `render-tech-lab` en lecture seule, sans rien y écrire), servie sur une origine locale et lancée
// dans Chromium avec Playwright. Image après image, la sélection WebGPU du moteur est calculée pour
// la caméra enfant d'un parent d'hôte déplacé puis tourné, puis pour la caméra sans parent de même
// pose monde. Les pages sélectionnées doivent être identiques ; sinon le script échoue.
//
//   node test/justesse/camera-parentee-gpu.mjs
//   (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from './pageWebgpu.mjs';

const ici = dirname(fileURLToPath(import.meta.url));

const script = await empaquetePage(resolve(ici, 'cameraParenteeGpuPage.mjs'), 'cameraParentee');
const erreursPage = [];
const resultat = await dansPageWebgpu(
  (pixelErrors) => globalThis.cameraParentee.executer(pixelErrors),
  [0, 3.5],
  { titre: 'Caméra parentée', script, erreursPage },
);
resultat.erreurs = [...(resultat.erreurs ?? []), ...erreursPage];

if (resultat.indisponible) throw new Error(resultat.indisponible);
console.log(`adaptateur : ${resultat.adaptateur}`);
let ecarts = 0;
for (const { pixelError, avecParent, sansParent } of resultat.cas) {
  for (let i = 0; i < avecParent.length; i++) {
    const rig = JSON.stringify(avecParent[i]),
      plate = JSON.stringify(sansParent[i]);
    const egal = rig === plate;
    if (!egal) ecarts++;
    console.log(
      `pixelError ${pixelError} image ${i} : ${egal ? 'identique' : 'ÉCART'}  rig ${rig}` +
        (egal ? '' : `  sans parent ${plate}`),
    );
  }
}
if (resultat.erreurs.length) console.log(`erreurs WebGPU : ${resultat.erreurs.join(' | ')}`);
console.log(`${ecarts} image(s) GPU en écart`);
if (ecarts || resultat.erreurs.length) process.exitCode = 1;
