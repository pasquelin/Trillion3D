// Correctness of a parented camera, CPU side.
//
// The camera is the child of a host group that belongs to no prepared scene; the parent is moved
// then rotated between two frames, without the host updating its rig. Every engine site that
// reads a camera pose (cameraSites.mjs) is called frame after frame with this rig, then with the
// parentless camera of the same world pose bit for bit. Any discrepancy is a defect: the script
// fails. The selection-uniform coherence residual (render frame, cameraSites.mjs) is printed.
//
//   node --experimental-strip-types test/justesse/camera-parentee.mjs
//
// `--empreinte <fichier>` records the same sites on parentless cameras instead: the first pass
// writes the file, the next compares bit for bit (before/after a fix).
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

/** `hote`: does the host update its rig before each frame? The engine must be correct in both cases. */
async function parentee(hote) {
  console.log(`\n— rig ${hote ? 'updated by the host' : 'left as-is by the host'} —`);
  const rigResidu = creeRig();
  const residus = POSES_PARENT.map((pose) => residuRepereDeRendu(poseRig(rigResidu, pose, hote)));
  console.log(
    `view·position residual per frame: ${residus.map((r) => r.toExponential(2)).join(' ')}`,
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
    const etat = ecarts.length ? `DISCREPANCY at frames ${ecarts.join(', ')}` : 'identical';
    console.log(`${site.nom} : ${etat}`);
    for (const i of ecarts.slice(0, 1))
      console.log(`  rig   ${avecParent[i].slice(0, 160)}\n  plate ${sansParent[i].slice(0, 160)}`);
  }
  console.log(
    `${fautifs} site(s) of ${SITES.length} in discrepancy over ${POSES_PARENT.length} frames`,
  );
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
    console.log(`fingerprint written: ${SITES.length} sites × ${POSES_SANS_PARENT.length} poses`);
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
  console.log(`total: ${identiques}/${comparees} readings identical bit for bit`);
  if (identiques !== comparees) process.exitCode = 1;
}

const indice = process.argv.indexOf('--empreinte');
if (indice > 0) await empreinte(process.argv[indice + 1]);
else for (const hote of [false, true]) await parentee(hote);
