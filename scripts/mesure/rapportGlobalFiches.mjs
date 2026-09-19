// Building blocks of the first page: witnesses and series, a card (question, verdict, sentence,
// body), the per-view bar card with its verdict — smaller is better, against the first
// witness — and the image pairs.
import { barres, html, nombre } from './rapportGlobalGraphes.mjs';
import { paire } from './rapportGlobalLecture.mjs';

// Witnesses of the first page, in bar order: the bench engine that plays them and the
// name of their series. The first is the verdict reference ("better than Three"). Campaign
// runs of a witness carry its engine as a prefix (`three-nu-1248`, `three-lod-lampes-4`).
export const TEMOINS = [
  { moteur: 'three-nu', serie: 'Three.js vanilla' },
  { moteur: 'three-lod', serie: 'Three.js LOD' },
];
export const NOTRE = 'Web Geometry';
// Les séries de chaque fiche : les témoins, notre moteur, Unreal. `valeurs(vue)` rend une valeur
// par série ; un témoin non mesuré vaut `null` et sa barre l'écrit.
const SERIES = [...TEMOINS.map((t) => t.serie), NOTRE, 'Unreal (its console)'];
const NOUS = TEMOINS.length;

/** Image-comparator views: the witness run suffix, the view, the label. */
const VUES_IMAGES = [
  ['-sans-ombres', 'sol', 'Street, no shadows'],
  ['-sans-ombres', 'generale', 'Overview, no shadows'],
  ['', 'sol', 'Street, with shadows'],
  ['', 'generale', 'Overview, with shadows'],
  ['', 'rue', 'Street corner, with shadows'],
  ['', 'detail', 'Sidewalk, with shadows'],
  ['-lampes-4', 'sol', 'Street, sun and four lights'],
  ['-lampes-4', 'generale', 'Overview, sun and four lights'],
  ['-1248', 'sol', 'Street, small screen'],
  ['-1248', 'generale', 'Overview, small screen'],
];

/** Image pairs of the comparator: the witness (before) and the engine (after), same run,
 *  witness by witness in bar order; the report lets the displayed witness be chosen. */
export const pairesImages = (ex) =>
  TEMOINS.flatMap(({ moteur, serie }) =>
    VUES_IMAGES.map(([suffixe, vue, libelle]) => {
      const [a, b] = paire(ex, moteur + suffixe, vue);
      return { temoin: serie, libelle, a: a?.png, b: b?.png };
    }),
  );

/** Verdict of an engine figure against the reference witness: smaller is better. */
function verdict(moteur, three) {
  if (moteur === null || three === null) return ['neutre', 'no comparison'];
  if (moteur < three * 0.8) return ['bon', `faster than Three (${nombre(three / moteur, 1)}×)`];
  if (moteur <= three * 1.2) return ['moyen', 'same as Three'];
  return ['mauvais', `slower than Three (${nombre(moteur / three, 1)}×)`];
}

/** A card, rendered by `grille`; `large` puts it on the full width by default. */
export function fiche(id, question, corps, [classe, mot], explication, large = false) {
  const rendu = (pleine) =>
    `<article id="${id}" class="fiche${pleine ? ' large' : ''}"><div class="fiche-texte"><h3>${html(question)}</h3><p class="fiche-verdict"><span class="pastille ${classe}"></span>${html(mot)}</p><p class="fiche-explication">${explication}</p></div><div class="fiche-corps">${corps}</div></article>`;
  rendu.large = large;
  return rendu;
}

/** Bars of a card: the four series, one row per view, first-page layout. */
export const barresSeries = (id, unite, lignes, decimales = 1) =>
  barres({ id, titre: unite, unite, series: SERIES, lignes, decimales, gauche: 150, grand: true });

/** A per-view bar card; the verdict reads each view and keeps the worst. */
export function fichePar(id, question, unite, vues, valeurs, explication, decimales = 1) {
  const lignes = vues.map(([vue, libelle]) => ({ libelle, valeurs: valeurs(vue) }));
  const rang = { bon: 0, moyen: 1, mauvais: 2, neutre: -1 };
  const verdicts = lignes.map((l) => {
    // The reference witness is the first of `TEMOINS`, our engine follows the witnesses.
    const t = l.valeurs[0],
      m = l.valeurs[NOUS];
    const [classe, mot] = verdict(
      typeof m === 'number' ? m : null,
      typeof t === 'number' ? t : null,
    );
    return [classe, lignes.length > 1 ? `${l.libelle}: ${mot}` : mot];
  });
  const pire = verdicts.reduce((a, b) => (rang[b[0]] > rang[a[0]] ? b : a));
  return fiche(
    id,
    question,
    barresSeries(id, unite, lignes, decimales),
    [pire[0], verdicts.map(([, mot]) => mot).join(' · ')],
    explication,
  );
}

/** Cards laid on two columns; a lone card on the last row takes both. */
export function grille(fiches) {
  let colonnes = 0;
  return fiches
    .map((f, i) => {
      const large = f.large || (i === fiches.length - 1 && colonnes % 2 === 0);
      colonnes = large ? Math.ceil(colonnes / 2) * 2 + 2 : colonnes + 1;
      return f(large);
    })
    .join('');
}
