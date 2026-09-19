// D'où viennent les triangles sélectionnés : la coupe de la vue générale au seuil 1 px, par
// primitive et par niveau du DAG. C'est le chiffre à lire sur Whisperwind (feuillage).
import { html, nombre, tableau } from './rapportGlobalGraphes.mjs';
import { trouve } from './rapportGlobalLecture.mjs';
import { analyserFichier, coupeVoisine, derivedDuReleve } from './coupeAnalyse.mjs';
import { join } from 'node:path';

const part = (n, total) => (total > 0 ? nombre((100 * n) / total, 1, '%') : '—');

const lignes = (liste, total, n) =>
  liste.slice(0, n).map((e) => [e.nom, nombre(e.triangles, 0), part(e.triangles, total)]);

function coupeDe(scene) {
  const r =
    trouve(scene.executions, 'mobile', 'generale', 1) ??
    trouve(scene.executions, 'mobile', 'sol', 1);
  if (!r) return { scene: scene.nom, analyse: null, releve: null, vue: null };
  const mesure = join(scene.dossier, r.run, 'mesure.json');
  const analyse = analyserFichier(
    coupeVoisine(scene.dossier, r.png),
    derivedDuReleve(mesure, r.cote),
  );
  return { scene: scene.nom, analyse, releve: r, vue: r.vue };
}

function bloc({ scene, analyse, releve, vue }) {
  if (!releve)
    return `<p><strong>${html(scene)}</strong> : exécution <code>mobile</code> absente — non mesuré.</p>`;
  if (!analyse)
    return `<p><strong>${html(scene)}</strong> : coupe de la vue ${html(vue)} absente — non mesuré.</p>`;
  const { total, inconnues, parPrimitive, parNiveau } = analyse;
  const mesurés = releve.triangles;
  return [
    `<p><strong>${html(scene)}</strong>, vue ${html(vue)}, seuil 1 px : ${nombre(total, 0)} triangles dans la coupe (${nombre(mesurés, 0)} publiés par le moteur)${inconnues ? `, ${nombre(inconnues, 0)} pages sans fiche` : ''}.</p>`,
    tableau(['Primitive', 'Triangles', 'Part'], lignes(parPrimitive, total, 12)),
    tableau(['Niveau DAG', 'Triangles', 'Part'], lignes(parNiveau, total, 12)),
  ].join('');
}

function verdictWhisperwind(item) {
  if (!item?.analyse) return '';
  const { parPrimitive, total } = item.analyse;
  const tete = parPrimitive[0];
  if (!tete || !total) return '';
  return `<div class="verdict">${html(item.scene)} : ${nombre(total / 1e6, 1)} M de triangles au seuil 1 px. Le premier poste est <strong>${html(tete.nom)}</strong> (${nombre((100 * tete.triangles) / total, 0)} %). Une carte de feuillage ne se réduit qu’en disparaissant ; la référence les clairseme et trame le masque.</div>`;
}

/** Section « d'où viennent les triangles » : une coupe par scène, plus le verdict Whisperwind. */
export function sectionCoupe(scenes) {
  const items = scenes.map(coupeDe);
  const whisper = items.find((i) => i.scene === 'whisperwind-village');
  return [
    '<p>La coupe de <code>mobile</code> au seuil 1 px, celle de la capture (pose calme), pages recoupées au cache compilé. Le moteur publie aussi les triangles de la dernière image mesurée — à caméra mobile les deux peuvent différer. Aucun chiffre n’est déduit hors de cette coupe.</p>',
    ...items.map(bloc),
    verdictWhisperwind(whisper),
  ].join('');
}
