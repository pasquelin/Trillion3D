// Les scènes d'une campagne : un dossier par scène sous le dossier de campagne, ou l'ancien
// plat (exécutions à la racine) lu comme une seule scène. Le rapport pose alors une colonne
// par scène, mêmes fiches, mêmes barres.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { html } from './rapportGlobalGraphes.mjs';
import { lireCampagne } from './rapportGlobalLecture.mjs';
import { REFERENCE_SCENES, SCENE_NOTES } from './scene.mjs';

const estExecution = (dir) => existsSync(join(dir, 'mesure.json'));

const estDossierDeScene = (dir) =>
  readdirSync(dir, { withFileTypes: true }).some(
    (e) => e.isDirectory() && estExecution(join(dir, e.name)),
  );

const rang = (nom) => {
  const i = REFERENCE_SCENES.indexOf(nom);
  return i < 0 ? 99 : i;
};

const sceneDe = (nom, dossier, ordre) => ({
  nom,
  dossier,
  note: SCENE_NOTES[nom] ?? '',
  executions: lireCampagne(dossier, ordre),
});

/** Les scènes présentes sous `dossier`, dans l'ordre des références puis le reste. */
export function lireScenes(dossier, ordre) {
  const enfants = readdirSync(dossier, { withFileTypes: true }).filter(
    (d) => d.isDirectory() && d.name !== 'vignettes',
  );
  const dossiers = enfants
    .map((d) => ({ nom: d.name, path: join(dossier, d.name) }))
    .filter((d) => !estExecution(d.path) && estDossierDeScene(d.path));
  if (dossiers.length) {
    dossiers.sort((a, b) => rang(a.nom) - rang(b.nom) || a.nom.localeCompare(b.nom));
    const scenes = dossiers.map((d) => sceneDe(d.nom, d.path, ordre));
    const plat = enfants.some((d) => estExecution(join(dossier, d.name)));
    if (plat && !scenes.some((s) => s.nom === REFERENCE_SCENES[0]))
      scenes.unshift(sceneDe(REFERENCE_SCENES[0], dossier, ordre));
    return scenes;
  }
  const executions = lireCampagne(dossier, ordre);
  const nom = executions.find((e) => e.scene)?.scene ?? '?';
  return [sceneDe(nom, dossier, ordre)];
}

/** Première page : une colonne par scène dès qu'il y en a deux, les quatre barres dans chacune. */
export function colonnesSimple(scenes, sectionSimple) {
  const col = (s) =>
    `<div><h3 class="scene">${html(s.nom)}</h3>${s.note ? `<p class="sous">${html(s.note)}</p>` : ''}${sectionSimple(s.executions, s.dossier)}</div>`;
  if (scenes.length < 2) return col(scenes[0]);
  return `<div class="scenes-cols">${scenes.map(col).join('')}</div>`;
}

/** Un bloc par scène, pour les sections détaillées du rapport. */
export function pourChaqueScene(scenes, rendu) {
  if (scenes.length === 1) return rendu(scenes[0]);
  return scenes.map((s) => `<h3 class="scene">${html(s.nom)}</h3>${rendu(s)}`).join('');
}

/** L'en-tête de campagne : scènes, machine, une ligne par exécution. */
export function enteteCampagne(scenes, { hostname, cpus, memoire, octets, tableau }) {
  const tous = scenes.flatMap((s) => s.executions);
  const premier = tous.find((e) => !e.absent);
  const prefixe = scenes.length > 1;
  const lignes = scenes.flatMap((s) =>
    s.executions.map((e) => [
      prefixe ? `${s.nom}/${e.nom}` : e.nom,
      e.pourquoi,
      e.absent ? 'absente' : `${e.releves.length} relevés`,
      e.absent ? e.erreur : e.erreurs.length ? `${e.erreurs.length} erreur(s)` : 'ok',
      e.absent || !e.fin ? '' : `${((new Date(e.fin) - new Date(e.debut)) / 1000).toFixed(0)} s`,
    ]),
  );
  const noms = scenes.map((s) => s.nom).join(', ');
  const debut = tous.find((e) => e.debut)?.debut ?? '?';
  const fin = [...tous].reverse().find((e) => e.fin)?.fin ?? '?';
  return [
    `<p>Scène${scenes.length > 1 ? 's' : ''} <code>${html(noms)}</code>, dépôt <code>${html(premier?.head?.slice(0, 8) ?? '?')}</code>, machine <code>${html(hostname)}</code> (${cpus} cœurs, ${octets(memoire)}), Chrome du poste, sans fenêtre sauf l’exécution <code>visible</code>. Campagne jouée du ${html(debut)} au ${html(fin)}. Les chiffres d’une machine ne valent que sur elle.</p>`,
    tableau(['Exécution', 'Ce qu’elle isole', 'Relevés', 'État', 'Durée'], lignes),
  ].join('');
}
