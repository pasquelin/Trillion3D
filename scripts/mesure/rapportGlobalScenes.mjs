// Scenes of a campaign: one folder per scene under the campaign folder, or the old
// flat layout (runs at the root) read as a single scene. The report then places one
// column per scene, same cards, same bars.
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

const rang = (name) => {
  const i = REFERENCE_SCENES.indexOf(name);
  return i < 0 ? 99 : i;
};

const sceneDe = (name, dossier, ordre) => ({
  name,
  dossier,
  note: SCENE_NOTES[name] ?? '',
  executions: lireCampagne(dossier, ordre),
});

/** Scenes present under `dossier`, in reference order then the rest. */
export function lireScenes(dossier, ordre) {
  const enfants = readdirSync(dossier, { withFileTypes: true }).filter(
    (d) => d.isDirectory() && d.name !== 'vignettes',
  );
  const dossiers = enfants
    .map((d) => ({ name: d.name, path: join(dossier, d.name) }))
    .filter((d) => !estExecution(d.path) && estDossierDeScene(d.path));
  if (dossiers.length) {
    dossiers.sort((a, b) => rang(a.name) - rang(b.name) || a.name.localeCompare(b.name));
    const scenes = dossiers.map((d) => sceneDe(d.name, d.path, ordre));
    const plat = enfants.some((d) => estExecution(join(dossier, d.name)));
    if (plat && !scenes.some((s) => s.name === REFERENCE_SCENES[0]))
      scenes.unshift(sceneDe(REFERENCE_SCENES[0], dossier, ordre));
    return scenes;
  }
  const executions = lireCampagne(dossier, ordre);
  const name = executions.find((e) => e.scene)?.scene ?? '?';
  return [sceneDe(name, dossier, ordre)];
}

/** First page: one column per scene as soon as there are two, the four bars in each. */
export function colonnesSimple(scenes, sectionSimple) {
  const col = (s) =>
    `<div><h3 class="scene">${html(s.name)}</h3>${s.note ? `<p class="sous">${html(s.note)}</p>` : ''}${sectionSimple(s.executions, s.dossier)}</div>`;
  if (scenes.length < 2) return col(scenes[0]);
  return `<div class="scenes-cols">${scenes.map(col).join('')}</div>`;
}

/** One block per scene, for the detailed sections of the report. */
export function pourChaqueScene(scenes, rendu) {
  if (scenes.length === 1) return rendu(scenes[0]);
  return scenes.map((s) => `<h3 class="scene">${html(s.name)}</h3>${rendu(s)}`).join('');
}

/** Campaign header: scenes, machine, one row per run. */
export function enteteCampagne(scenes, { hostname, cpus, memoire, octets, tableau }) {
  const tous = scenes.flatMap((s) => s.executions);
  const premier = tous.find((e) => !e.absent);
  const prefixe = scenes.length > 1;
  const lignes = scenes.flatMap((s) =>
    s.executions.map((e) => [
      prefixe ? `${s.name}/${e.name}` : e.name,
      e.pourquoi,
      e.absent ? 'missing' : `${e.releves.length} samples`,
      e.absent ? e.erreur : e.erreurs.length ? `${e.erreurs.length} error(s)` : 'ok',
      e.absent || !e.fin ? '' : `${((new Date(e.fin) - new Date(e.debut)) / 1000).toFixed(0)} s`,
    ]),
  );
  const names = scenes.map((s) => s.name).join(', ');
  const debut = tous.find((e) => e.debut)?.debut ?? '?';
  const fin = [...tous].reverse().find((e) => e.fin)?.fin ?? '?';
  return [
    `<p>Scene${scenes.length > 1 ? 's' : ''} <code>${html(names)}</code>, repo <code>${html(premier?.head?.slice(0, 8) ?? '?')}</code>, machine <code>${html(hostname)}</code> (${cpus} cores, ${octets(memoire)}), local Chrome, no window except the <code>visible</code> run. Campaign ran from ${html(debut)} to ${html(fin)}. Numbers from one machine hold only on that machine.</p>`,
    tableau(['Run', 'What it isolates', 'Samples', 'Status', 'Duration'], lignes),
  ].join('');
}
