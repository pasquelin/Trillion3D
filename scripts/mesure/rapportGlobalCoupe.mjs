// Where selected triangles come from: the overview cut at the 1 px threshold, by
// primitive and by DAG level. That is the figure to read on Whisperwind (foliage).
import { html, nombre, tableau } from './rapportGlobalGraphes.mjs';
import { trouve } from './rapportGlobalLecture.mjs';
import { analyseFile, neighboringCut, derivedFromReading } from './coupeAnalyse.mjs';
import { join } from 'node:path';

const part = (n, total) => (total > 0 ? nombre((100 * n) / total, 1, '%') : '—');

const lignes = (liste, total, n) =>
  liste.slice(0, n).map((e) => [e.name, nombre(e.triangles, 0), part(e.triangles, total)]);

function coupeDe(scene) {
  const r =
    trouve(scene.executions, 'mobile', 'generale', 1) ??
    trouve(scene.executions, 'mobile', 'sol', 1);
  if (!r) return { scene: scene.name, analyse: null, reading: null, view: null };
  const mesure = join(scene.dossier, r.run, 'mesure.json');
  const analyse = analyseFile(
    neighboringCut(scene.dossier, r.png),
    derivedFromReading(mesure, r.side),
  );
  return { scene: scene.name, analyse, reading: r, view: r.vue };
}

function bloc({ scene, analyse, releve, vue }) {
  if (!releve)
    return `<p><strong>${html(scene)}</strong>: <code>mobile</code> run missing — not measured.</p>`;
  if (!analyse)
    return `<p><strong>${html(scene)}</strong>: cut for view ${html(vue)} missing — not measured.</p>`;
  const { total, inconnues, parPrimitive, parNiveau } = analyse;
  const mesurés = releve.triangles;
  return [
    `<p><strong>${html(scene)}</strong>, ${html(vue)} view, 1 px threshold: ${nombre(total, 0)} triangles in the cut (${nombre(mesurés, 0)} published by the engine)${inconnues ? `, ${nombre(inconnues, 0)} pages with no record` : ''}.</p>`,
    tableau(['Primitive', 'Triangles', 'Share'], lignes(parPrimitive, total, 12)),
    tableau(['DAG level', 'Triangles', 'Share'], lignes(parNiveau, total, 12)),
  ].join('');
}

function verdictWhisperwind(item) {
  if (!item?.analyse) return '';
  const { parPrimitive, total } = item.analyse;
  const tete = parPrimitive[0];
  if (!tete || !total) return '';
  return `<div class="verdict">${html(item.scene)}: ${nombre(total / 1e6, 1)} M triangles at the 1 px threshold. The top item is <strong>${html(tete.nom)}</strong> (${nombre((100 * tete.triangles) / total, 0)} %). A foliage card only shrinks by disappearing; the reference thins them and dithers the mask.</div>`;
}

/** "Where triangles come from" section: one cut per scene, plus the Whisperwind verdict. */
export function sectionCoupe(scenes) {
  const items = scenes.map(coupeDe);
  const whisper = items.find((i) => i.scene === 'whisperwind-village');
  return [
    '<p>The <code>mobile</code> cut at the 1 px threshold, from the capture (settled pose), pages matched against the compiled cache. The engine also publishes triangles from the last measured frame — with a moving camera the two can differ. No figure is inferred outside this cut.</p>',
    ...items.map(bloc),
    verdictWhisperwind(whisper),
  ].join('');
}
