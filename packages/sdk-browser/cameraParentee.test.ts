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

/** Résidu de la vue appliquée à la position monde : nul à l'arrondi près si elles concordent. */
function residu(camera: Parameters<typeof cameraSelectionUniforms>[0]) {
  const u = cameraSelectionUniforms(camera, 1, [1280, 720]);
  const v = u.view,
    [x, y, z] = u.cameraWorld;
  return Math.hypot(
    v[0]! * x! + v[4]! * y! + v[8]! * z! + v[12]!,
    v[1]! * x! + v[5]! * y! + v[9]! * z! + v[13]!,
    v[2]! * x! + v[6]! * y! + v[10]! * z! + v[14]!,
  );
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

  test(`uniformes de sélection : vue et position monde concordent, rig ${contrat}`, () => {
    const rig = creeRig();
    for (const pose of POSES_PARENT)
      assert.ok(
        residu(poseRig(rig, pose, hote) as Parameters<typeof cameraSelectionUniforms>[0]) <= 1e-6,
        'la vue et la position monde décrivent deux caméras différentes',
      );
  });
}
