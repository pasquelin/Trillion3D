// Justesse d'une caméra parentée, côté processeur.
//
// La caméra est l'enfant d'un groupe d'hôte qui n'appartient à aucune scène préparée ; le parent est
// déplacé puis tourné entre deux images, sans que l'hôte mette son rig à jour. Chaque site du moteur
// qui lit la pose d'une caméra (cameraSites.mjs) est appelé image après image avec ce rig, puis avec
// la caméra sans parent de même pose monde au bit près. Tout écart est un défaut : le script échoue.
// Le résidu de cohérence des uniformes de sélection (repère de rendu, cameraSites.mjs) est affiché.
//
//   node --experimental-strip-types test/justesse/camera-parentee.mjs
//
// `--empreinte <fichier>` relève à la place les mêmes sites sur des caméras sans parent : le premier
// passage écrit le fichier, le suivant compare au bit près (avant/après une correction).
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import {
  POSES_PARENT,
  POSES_SANS_PARENT,
  cameraAplatie,
  cameraSansParent,
  creeRig,
  poseRig,
} from './cameraRig.mjs';
import { SITES, residuRepereDeRendu } from './cameraSites.mjs';

const texte = (valeur) => JSON.stringify(valeur);

async function sequence(site, cameras) {
  const etat = await site.cree?.();
  const valeurs = [];
  for (const camera of cameras()) valeurs.push(texte(await site.mesure(etat, camera)));
  etat?.backend?.dispose?.();
  etat?.dispose?.();
  return valeurs;
}

/** `hote` : l'hôte met-il son rig à jour avant chaque image ? Le moteur doit être juste dans les deux cas. */
async function parentee(hote) {
  console.log(`\n— rig ${hote ? 'mis à jour par l’hôte' : 'laissé tel quel par l’hôte'} —`);
  const rigResidu = creeRig();
  const residus = POSES_PARENT.map((pose) => residuRepereDeRendu(poseRig(rigResidu, pose, hote)));
  console.log(
    `résidu vue·position par image : ${residus.map((r) => r.toExponential(2)).join(' ')}`,
  );
  let fautifs = 0;
  for (const site of SITES) {
    const rig = creeRig();
    const avecParent = await sequence(site, function* () {
      for (const pose of POSES_PARENT) yield poseRig(rig, pose, hote);
    });
    const sansParent = await sequence(site, function* () {
      for (const pose of POSES_PARENT) yield cameraAplatie(pose);
    });
    const ecarts = POSES_PARENT.map((_, i) => i).filter((i) => avecParent[i] !== sansParent[i]);
    if (ecarts.length) fautifs++;
    const etat = ecarts.length ? `ÉCART aux images ${ecarts.join(', ')}` : 'identique';
    console.log(`${site.nom} : ${etat}`);
    for (const i of ecarts.slice(0, 1))
      console.log(`  rig   ${avecParent[i].slice(0, 160)}\n  plate ${sansParent[i].slice(0, 160)}`);
  }
  console.log(`${fautifs} site(s) sur ${SITES.length} en écart sur ${POSES_PARENT.length} images`);
  if (fautifs || residus.some((r) => r > 1e-4)) process.exitCode = 1;
}

async function empreinte(fichier) {
  const releve = {};
  for (const site of SITES)
    releve[site.nom] = await sequence(site, function* () {
      for (const pose of POSES_SANS_PARENT) yield cameraSansParent(pose);
    });
  if (!existsSync(fichier)) {
    await writeFile(fichier, JSON.stringify(releve));
    console.log(`empreinte écrite : ${SITES.length} sites × ${POSES_SANS_PARENT.length} poses`);
    return;
  }
  const reference = JSON.parse(await readFile(fichier, 'utf8'));
  let identiques = 0,
    comparees = 0;
  for (const site of SITES) {
    const avant = reference[site.nom] ?? [],
      apres = releve[site.nom];
    const differentes = apres.filter((valeur, i) => valeur !== avant[i]).length;
    comparees += apres.length;
    identiques += apres.length - differentes;
    console.log(`${site.nom} : ${apres.length - differentes}/${apres.length} poses identiques`);
  }
  console.log(`total : ${identiques}/${comparees} relevés identiques au bit près`);
  if (identiques !== comparees) process.exitCode = 1;
}

const indice = process.argv.indexOf('--empreinte');
if (indice > 0) await empreinte(process.argv[indice + 1]);
else for (const hote of [false, true]) await parentee(hote);
