// Défaut 5 : une caméra parentée doit donner la même pose à TOUS les sites du moteur.
//
// Chaque site de `bench/justesse/cameraSites.mjs` — uniformes de sélection, coupe, Hi-Z, rasters,
// diagnostics, et les moteurs entiers sur le faux périphérique GPU — est appelé image après image
// avec une caméra enfant d'un groupe d'hôte qui n'appartient à aucune scène préparée, puis avec la
// caméra sans parent de même pose monde au bit près. Les deux relevés doivent être égaux.
//
// Les deux contrats d'hôte sont exercés : celui qui remonte son rig avant l'image et celui qui ne le
// fait pas. Le moteur doit être juste dans les deux cas, car un rig hors scène n'est remonté par
// personne d'autre que lui.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { POSES_PARENT, cameraAplatie, creeRig, poseRig } from './bench/justesse/cameraRig.mjs';
import { SITES } from './bench/justesse/cameraSites.mjs';
import { cameraMoteur } from './cameraFixture.ts';

type Pose = (typeof POSES_PARENT)[number];
type Site = {
  nom: string;
  cree?: () => unknown;
  mesure: (etat: unknown, camera: unknown) => unknown;
};

/** Un site déroulé sur la séquence d'images, rendu en textes comparables au caractère près. */
async function releve(site: Site, camera: (pose: Pose) => unknown) {
  const etat = (await site.cree?.()) as
    { backend?: { dispose?: () => void }; dispose?: () => void } | undefined;
  const images: string[] = [];
  for (const pose of POSES_PARENT)
    images.push(JSON.stringify(await site.mesure(etat, camera(pose))));
  etat?.backend?.dispose?.();
  etat?.dispose?.();
  return images;
}

/** Un point monde passé par une matrice 4×4 colonne-major. */
function applique(m: ArrayLike<number>, [x, y, z]: [number, number, number]) {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

/**
 * Résidu de la composition du repère de rendu. Les uniformes publient une vue SANS translation et
 * la position monde de l'œil, qui est l'origine de ce repère : toute la translation est passée dans
 * les matrices monde, que le moteur ramène à cette origine. Appliquer la vue relative à un point
 * ainsi ramené doit donc rendre, à l'arrondi simple précision près, ce que la vue absolue rend du
 * même point. Non nul dès que la position publiée n'est pas celle de la vue — un rig non remonté,
 * par exemple : c'est elle, désormais, qui porte le déplacement de la caméra.
 */
function residu(camera: Parameters<typeof cameraMoteur>[0]) {
  const cam = cameraMoteur(camera);
  const u = cameraSelectionUniforms(cam, 1, [1280, 720]);
  const sonde: [number, number, number] = [12, -7, 31];
  const ramene: [number, number, number] = [
    sonde[0] - u.cameraWorld[0],
    sonde[1] - u.cameraWorld[1],
    sonde[2] - u.cameraWorld[2],
  ];
  const absolu = applique(cam.view, sonde),
    relatif = applique(u.view, ramene);
  return Math.hypot(absolu[0]! - relatif[0]!, absolu[1]! - relatif[1]!, absolu[2]! - relatif[2]!);
}

for (const hote of [false, true]) {
  const contrat = hote ? 'remonté par l’hôte' : 'laissé tel quel par l’hôte';
  for (const site of SITES as Site[])
    test(`${site.nom} : caméra parentée, rig ${contrat}`, async () => {
      const rig = creeRig();
      const parentee = await releve(site, (pose) => poseRig(rig, pose, hote));
      const aplatie = await releve(site, (pose) => cameraAplatie(pose));
      for (let i = 0; i < POSES_PARENT.length; i++)
        assert.equal(parentee[i], aplatie[i], `image ${i} : le rig ne donne pas la pose aplatie`);
    });

  test(`uniformes de sélection : vue relative et origine de rendu concordent, rig ${contrat}`, () => {
    const rig = creeRig();
    for (const pose of POSES_PARENT)
      assert.ok(
        // Le seuil est celui de l'arrondi simple précision d'une sonde à quelques dizaines de
        // mètres ; une pose fausse, elle, se compte en mètres.
        residu(poseRig(rig, pose, hote) as Parameters<typeof cameraMoteur>[0]) <= 1e-4,
        'la vue relative et l’origine du repère de rendu décrivent deux caméras différentes',
      );
  });
}
