// Banc du lot C. Le lot A exige l'égalité bit à bit ; ici les changements peuvent déplacer l'ordre
// des opérations flottantes, donc le banc ne se contente pas de dire « différent » : il compte les
// valeurs qui diffèrent, mesure l'écart maximal en ULP et, pour le visbuffer, les pixels dont
// l'identifiant ou la profondeur change. Une ligne n'est retenue que si elle est identique, ou si
// la tolérance déclarée par le point est respectée ET que la mesure montre un gain.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE, mediane as chronometre } from './banc.mjs';
import { compteur, parcours } from './ecartsC.mjs';

const FRAGMENTS = join(RACINE, '.mesure', 'calculs-c');
/** Le chronomètre du lot A, avec les réglages du lot C : ses tours sont plus lourds. */
async function mediane(tour, options = {}) {
  const { ms } = await chronometre(tour, { chauffe: 8, tours: 120, budgetMs: 2500, ...options });
  return ms;
}

function texteEcart(c) {
  if (!c.nombre) return null;
  const morceaux = [`${c.nombre} valeurs`, `ULP max ${c.ulpMax}`];
  if (c.pixelsId) morceaux.push(`${c.pixelsId} pixels d'identifiant`);
  if (c.pixelsProfondeur) morceaux.push(`${c.pixelsProfondeur} pixels de profondeur`);
  if (c.horsCoupe) morceaux.push(`dont ${c.horsCoupe} hors de la coupe`);
  return `${morceaux.join(', ')} — ${c.premier}`;
}

/**
 * Une ligne du tableau. `differences` rend un compteur pour un cas ; à défaut le parcours générique
 * s'en charge. `tolere` décide si un écart non nul reste acceptable (identifiants de pixels intacts,
 * profondeurs à 1 ULP, coupe strictement identique) ; sans gain la ligne tombe quand même à « non ».
 */
export async function compareC({
  calcul,
  fichier,
  cas,
  reference,
  optimisee,
  differences,
  tolere,
  options,
}) {
  const total = compteur();
  for (const item of cas) {
    const attendu = await reference(item.entree);
    const obtenu = await optimisee(item.entree);
    const c = differences
      ? differences(attendu, obtenu, item.nom)
      : parcours(compteur(), attendu, obtenu, item.nom);
    total.nombre += c.nombre;
    total.pixelsId += c.pixelsId;
    total.pixelsProfondeur += c.pixelsProfondeur;
    total.horsCoupe += c.horsCoupe;
    if (c.ulpMax > total.ulpMax) total.ulpMax = c.ulpMax;
    total.premier ??= c.premier;
  }
  const chronos = cas.filter((item) => item.mesure !== false);
  const avantMs = await mediane(async () => {
    for (const item of chronos) await reference(item.entree);
  }, options);
  const apresMs = await mediane(async () => {
    for (const item of chronos) await optimisee(item.entree);
  }, options);
  const identique = total.nombre === 0;
  const acceptable = identique || !!(tolere && tolere(total));
  return {
    calcul,
    fichier,
    avantMs,
    apresMs,
    gain: avantMs > 0 ? (avantMs - apresMs) / avantMs : null,
    identique,
    ecart: texteEcart(total),
    retenu: acceptable && apresMs < avantMs,
    entrees: cas.map((item) => ({ nom: item.nom, taille: item.taille ?? null })),
  };
}

/** Une ligne écrite à la main : un point qu'aucune réécriture ne rend identique, mesures à `null`. */
export function ligneDecrite({ calcul, fichier, ecart }) {
  return {
    calcul,
    fichier,
    avantMs: null,
    apresMs: null,
    gain: null,
    identique: false,
    ecart,
    retenu: false,
    entrees: [],
  };
}

const nombre = (v) => (v === null ? 'null' : v.toFixed(3));
const pourcent = (v) => (v === null ? 'null' : `${(v * 100).toFixed(1)} %`);
export const ENTETE_C =
  '| Calcul | Fichier | Avant (ms) | Après (ms) | Gain | Identique | Écart | Retenu |';
export const SEPARATEUR_C = '|---|---|---|---|---|---|---|---|';

export function ligneMarkdownC(l) {
  return `| ${l.calcul} | \`${l.fichier}\` | ${nombre(l.avantMs)} | ${nombre(l.apresMs)} | ${pourcent(
    l.gain,
  )} | ${l.identique ? 'oui' : 'non'} | ${l.ecart ?? '—'} | ${l.retenu ? 'oui' : 'non'} |`;
}

export function deposeC(domaine, lignes) {
  mkdirSync(FRAGMENTS, { recursive: true });
  writeFileSync(join(FRAGMENTS, `${domaine}.json`), JSON.stringify(lignes, null, 2));
  for (const ligne of lignes) console.log(ligneMarkdownC(ligne));
}
