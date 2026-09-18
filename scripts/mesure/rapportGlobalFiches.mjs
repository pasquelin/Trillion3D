// Les briques de la première page : une fiche (question, verdict, phrase, corps), la fiche à trois
// barres par vue avec son verdict — plus petit est mieux, face à Three —, et les paires d'images.
import { barres, html, nombre } from './rapportGlobalGraphes.mjs';
import { paire } from './rapportGlobalLecture.mjs';

export const SERIES = ['Three.js nu', 'Notre moteur', 'Unreal (sa console)'];

/** Les paires d'images du comparateur : Three.js (avant) et le moteur (après), même exécution. */
const PAIRES = [
  ['three-nu-sans-ombres', 'sol', 'Rue, sans ombres'],
  ['three-nu-sans-ombres', 'generale', 'Vue de haut, sans ombres'],
  ['three-nu', 'sol', 'Rue, avec ombres'],
  ['three-nu', 'generale', 'Vue de haut, avec ombres'],
  ['three-nu', 'rue', 'Carrefour, avec ombres'],
  ['three-nu', 'detail', 'Trottoir, avec ombres'],
  ['three-nu-lampes-4', 'sol', 'Rue, soleil et quatre lampes'],
  ['three-nu-lampes-4', 'generale', 'Vue de haut, soleil et quatre lampes'],
  ['three-nu-1248', 'sol', 'Rue, petit écran'],
  ['three-nu-1248', 'generale', 'Vue de haut, petit écran'],
];
export const pairesImages = (ex) =>
  PAIRES.map(([run, vue, libelle]) => {
    const [a, b] = paire(ex, run, vue);
    return { libelle, a: a?.png, b: b?.png };
  });

/** Le verdict d'un chiffre du moteur face à Three : plus petit est mieux. */
function verdict(moteur, three) {
  if (moteur === null || three === null) return ['neutre', 'pas de comparaison possible'];
  if (moteur < three * 0.8) return ['bon', `mieux que Three (${nombre(three / moteur, 1)}×)`];
  if (moteur <= three * 1.2) return ['moyen', 'pareil que Three'];
  return ['mauvais', `moins bien que Three (${nombre(moteur / three, 1)}×)`];
}

/** Une fiche ; `large` la met sur toute la largeur. Rend une fonction pour que la page décide. */
export const fiche =
  (id, question, corps, [classe, mot], explication) =>
  (large) =>
    `<article id="${id}" class="fiche${large ? ' large' : ''}"><div class="fiche-texte"><h3>${html(question)}</h3><p class="fiche-verdict"><span class="pastille ${classe}"></span>${html(mot)}</p><p class="fiche-explication">${explication}</p></div><div class="fiche-corps">${corps}</div></article>`;

/** Une fiche à trois barres par vue ; le verdict lit chaque vue et garde le moins bon. */
export function fichePar(id, question, unite, vues, valeurs, explication, decimales = 1) {
  const lignes = vues.map(([vue, libelle]) => ({ libelle, valeurs: valeurs(vue) }));
  const rang = { bon: 0, moyen: 1, mauvais: 2, neutre: -1 };
  const verdicts = lignes.map((l) => {
    const [t, m] = l.valeurs;
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
    barres({
      id,
      titre: unite,
      unite,
      series: SERIES,
      lignes,
      decimales,
      gauche: 150,
      grand: true,
    }),
    [pire[0], verdicts.map(([, mot]) => mot).join(' · ')],
    explication,
  );
}

/** Les fiches posées sur deux colonnes ; une fiche seule sur la dernière ligne prend les deux. */
export function grille(fiches, larges = new Set()) {
  let colonnes = 0;
  return fiches
    .map((f, i) => {
      const large = larges.has(i) || (i === fiches.length - 1 && colonnes % 2 === 0);
      colonnes = large ? Math.ceil(colonnes / 2) * 2 + 2 : colonnes + 1;
      return f(large);
    })
    .join('');
}
