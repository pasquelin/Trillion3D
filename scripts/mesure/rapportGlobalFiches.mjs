// Les briques de la première page : les témoins et les séries, une fiche (question, verdict, phrase,
// corps), la fiche à barres par vue avec son verdict — plus petit est mieux, face au premier
// témoin —, et les paires d'images.
import { barres, html, nombre } from './rapportGlobalGraphes.mjs';
import { paire } from './rapportGlobalLecture.mjs';

// Les témoins de la première page, dans l'ordre des barres : le moteur du banc qui les joue et le
// nom de leur série. Le premier est la référence des verdicts (« mieux que Three »). Les exécutions
// de la campagne d'un témoin portent son moteur en préfixe (`three-nu-1248`, `three-lod-lampes-4`).
export const TEMOINS = [
  { moteur: 'three-nu', serie: 'Three.js vanilla' },
  { moteur: 'three-lod', serie: 'Three.js LOD' },
];
export const NOTRE = 'Web Geometry';
// Les séries de chaque fiche : les témoins, notre moteur, Unreal. `valeurs(vue)` rend une valeur
// par série ; un témoin non mesuré vaut `null` et sa barre l'écrit.
const SERIES = [...TEMOINS.map((t) => t.serie), NOTRE, 'Unreal (its console)'];
const NOUS = TEMOINS.length;

/** Les vues du comparateur d'images : le suffixe d'exécution du témoin, la vue, le libellé. */
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

/** Les paires d'images du comparateur : le témoin (avant) et le moteur (après), même exécution,
 *  témoin par témoin dans l'ordre des barres ; le rapport laisse choisir le témoin affiché. */
export const pairesImages = (ex) =>
  TEMOINS.flatMap(({ moteur, serie }) =>
    VUES_IMAGES.map(([suffixe, vue, libelle]) => {
      const [a, b] = paire(ex, moteur + suffixe, vue);
      return { temoin: serie, libelle, a: a?.png, b: b?.png };
    }),
  );

/** Le verdict d'un chiffre du moteur face au témoin de référence : plus petit est mieux. */
function verdict(moteur, three) {
  if (moteur === null || three === null) return ['neutre', 'no comparison'];
  if (moteur < three * 0.8) return ['bon', `faster than Three (${nombre(three / moteur, 1)}×)`];
  if (moteur <= three * 1.2) return ['moyen', 'same as Three'];
  return ['mauvais', `slower than Three (${nombre(moteur / three, 1)}×)`];
}

/** Une fiche, rendue par `grille` ; `large` la met d'office sur toute la largeur. */
export function fiche(id, question, corps, [classe, mot], explication, large = false) {
  const rendu = (pleine) =>
    `<article id="${id}" class="fiche${pleine ? ' large' : ''}"><div class="fiche-texte"><h3>${html(question)}</h3><p class="fiche-verdict"><span class="pastille ${classe}"></span>${html(mot)}</p><p class="fiche-explication">${explication}</p></div><div class="fiche-corps">${corps}</div></article>`;
  rendu.large = large;
  return rendu;
}

/** Les barres d'une fiche : les quatre séries, une ligne par vue, la mise en page de la première page. */
export const barresSeries = (id, unite, lignes, decimales = 1) =>
  barres({ id, titre: unite, unite, series: SERIES, lignes, decimales, gauche: 150, grand: true });

/** Une fiche à barres par vue ; le verdict lit chaque vue et garde le moins bon. */
export function fichePar(id, question, unite, vues, valeurs, explication, decimales = 1) {
  const lignes = vues.map(([vue, libelle]) => ({ libelle, valeurs: valeurs(vue) }));
  const rang = { bon: 0, moyen: 1, mauvais: 2, neutre: -1 };
  const verdicts = lignes.map((l) => {
    // Le témoin de référence est le premier de `TEMOINS`, notre moteur suit les témoins.
    const t = l.valeurs[0],
      m = l.valeurs[NOUS];
    const [classe, mot] = verdict(
      typeof m === 'number' ? m : null,
      typeof t === 'number' ? t : null,
    );
    return [classe, lignes.length > 1 ? `${l.libelle} : ${mot}` : mot];
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

/** Les fiches posées sur deux colonnes ; une fiche seule sur la dernière ligne prend les deux. */
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
