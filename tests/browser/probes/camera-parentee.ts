// Correctness of a parented camera, CPU side.
//
// The camera is the child of a host group that belongs to no prepared scene; the parent is moved
// then rotated between two frames, without the host updating its rig. Every engine site that
// reads a camera pose (cameraSites.ts) is called frame after frame with this rig, then with the
// parentless camera of the same world pose bit for bit. Any discrepancy is a defect: the script
// fails. The selection-uniform coherence residual (render frame, cameraSites.ts) is printed.
//
//   node --experimental-strip-types tests/browser/probes/camera-parentee.ts
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
} from './cameraRig.ts';
import { SITES, residuRepereDeRendu } from './cameraSites.ts';
import type { Site } from './cameraSitesMoteurs.ts';
import type { HostCamera } from '../../../packages/sdk-browser/cameraWorld.ts';

const texte = (valeur: unknown): string => JSON.stringify(valeur);

/** A site's state, when it happens to carry a disposable backend or its own `dispose`: neither
 *  is part of the `Site` contract, both are read defensively as this campaign always has. */
type Disposable = { backend?: { dispose?: () => void }; dispose?: () => void };

async function sequence(site: Site, cameras: () => Generator<HostCamera>): Promise<string[]> {
  const etat = (await site.cree?.()) as Disposable | undefined;
  const valeurs: string[] = [];
  for (const camera of cameras()) valeurs.push(texte(await site.mesure(etat, camera)));
  etat?.backend?.dispose?.();
  etat?.dispose?.();
  return valeurs;
}

/** `hote`: does the host update its rig before each frame? The engine must be correct in both cases. */
async function parentee(hote: boolean): Promise<void> {
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

async function empreinte(fichier: string): Promise<void> {
  const releve: Record<string, string[]> = {};
  for (const site of SITES)
    releve[String(site.nom)] = await sequence(site, function* () {
      for (const pose of POSES_SANS_PARENT) yield cameraSansParent(pose);
    });
  if (!existsSync(fichier)) {
    await writeFile(fichier, JSON.stringify(releve));
    console.log(`fingerprint written: ${SITES.length} sites × ${POSES_SANS_PARENT.length} poses`);
    return;
  }
  const reference: Record<string, string[]> = JSON.parse(await readFile(fichier, 'utf8'));
  let identiques = 0,
    comparees = 0;
  for (const site of SITES) {
    const avant = reference[String(site.nom)] ?? [],
      apres = releve[String(site.nom)];
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
