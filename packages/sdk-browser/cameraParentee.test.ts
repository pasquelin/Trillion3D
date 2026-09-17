// Défaut 5 : une caméra parentée doit donner la même pose à TOUS les sites du moteur.
//
// Chaque site de `test/justesse/cameraSites.mjs` — uniformes de sélection, coupe, Hi-Z, rasters,
// diagnostics, et les moteurs entiers sur le faux périphérique GPU — est appelé image après image
// avec une caméra enfant d'un groupe d'hôte qui n'appartient à aucune scène préparée, puis avec la
// caméra sans parent de même pose monde au bit près. Les deux relevés doivent être égaux.
//
// Les deux contrats d'hôte sont exercés : celui qui remonte son rig avant l'image et celui qui ne le
// fait pas. Le moteur doit être juste dans les deux cas, car un rig hors scène n'est remonté par
// personne d'autre que lui.
import test from 'node:test';
import assert from 'node:assert/strict';
import { POSES_PARENT, cameraAplatie, creeRig, poseRig } from '../../test/justesse/cameraRig.mjs';
import { SITES, residuRepereDeRendu } from '../../test/justesse/cameraSites.mjs';

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
        residuRepereDeRendu(poseRig(rig, pose, hote)) <= 1e-4,
        'la vue relative et l’origine du repère de rendu décrivent deux caméras différentes',
      );
  });
}
