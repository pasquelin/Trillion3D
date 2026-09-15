// Défaut 4 : les cas d'adressage d'un texel et la règle de Three à laquelle on les compare.
//
// Three ne choisit pas lui-même le texel : il confie le mode de la carte à l'échantillonneur de la
// carte graphique (`WebGLTextures` : RepeatWrapping → REPEAT, MirroredRepeatWrapping →
// MIRRORED_REPEAT, ClampToEdgeWrapping → CLAMP_TO_EDGE). La référence est donc la règle entière
// de la spécification OpenGL ES 3.0 (§ 3.8.10), la même que WebGPU : i = ⌊u·taille⌋, puis
// serrage, modulo, ou modulo sur deux périodes dont la seconde est lue à rebours. Le script GPU
// vérifie cette référence contre les vrais échantillonneurs, cas par cas.
import * as THREE from 'three';

export const MODES = [
  ['ClampToEdge', THREE.ClampToEdgeWrapping],
  ['Repeat', THREE.RepeatWrapping],
  ['MirroredRepeat', THREE.MirroredRepeatWrapping],
];

/** Le texel que l'échantillonneur au plus proche retient sur un axe de `taille` texels. */
export function texelThree(t, taille, wrap) {
  const i = Math.floor(t * taille);
  if (wrap === THREE.ClampToEdgeWrapping) return Math.min(taille - 1, Math.max(0, i));
  const periode = wrap === THREE.RepeatWrapping ? taille : 2 * taille;
  const j = ((i % periode) + periode) % periode;
  return j < taille ? j : periode - 1 - j;
}

/** Vrai quand la coordonnée tombe, à 1e-3 texel près, sur la frontière de deux texels. */
export const surFrontiere = (t, taille) => Math.abs(t * taille - Math.round(t * taille)) < 1e-3;

/**
 * Les coordonnées d'un axe de `taille` texels, arrondies en flottant 32 bits comme la carte
 * graphique les reçoit : entières, centres de texel (demi-texel), frontières, négatives, voisines
 * de 0 et de 1, et grandes (±1e3) sur les deux parités de période.
 */
export function coordonnees(taille) {
  const out = [-1001, -1000, -3, -2, -1, 0, 1, 2, 3, 1000, 1001, 0.999, -0.001, 1.001, -0.999];
  for (const p of [-3, -2, -1, 0, 1, 2])
    for (let k = 0; k < taille; k++) out.push(p + (k + 0.5) / taille);
  for (const p of [-2, -1, 0, 1]) for (let k = 1; k < taille; k++) out.push(p + k / taille);
  for (const p of [-1001, -1000, 1000, 1001])
    for (let k = 0; k < taille; k++) out.push(p + (k + 0.5) / taille);
  return out.map(Math.fround);
}

/** L'autre axe, fixé hors frontière à 1,3 : les trois modes y lisent trois texels différents. */
export const AUTRE_AXE = Math.fround(1.3);

/**
 * Les textures de test, une taille paire et une impaire sur chaque axe. Texel (x, y) : rouge
 * 20 + 40x, vert 20 + 40y, alpha 10 + 10·rang — toutes les composantes distinctes.
 */
export const TAILLES = [
  [4, 5],
  [5, 4],
];
export function octetsTexture(largeur, hauteur) {
  const data = new Uint8Array(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++)
    for (let x = 0; x < largeur; x++) {
      const o = (y * largeur + x) * 4;
      data.set([20 + 40 * x, 20 + 40 * y, 0, 10 + 10 * (y * largeur + x)], o);
    }
  return data;
}

/**
 * Tous les cas : chaque taille, chaque axe éprouvé, chaque couple de modes (S, T). La coordonnée
 * éprouvée parcourt `coordonnees`, l'autre vaut `AUTRE_AXE`. `attendu` est le texel (x, y) de Three.
 */
export function cas() {
  const out = [];
  for (const [largeur, hauteur] of TAILLES)
    for (const axe of ['u', 'v']) {
      const taille = axe === 'u' ? largeur : hauteur;
      for (const [nomS, wrapS] of MODES)
        for (const [nomT, wrapT] of MODES)
          for (const t of coordonnees(taille)) {
            const u = axe === 'u' ? t : AUTRE_AXE,
              v = axe === 'v' ? t : AUTRE_AXE;
            const eprouve = axe === 'u' ? nomS : nomT;
            out.push({
              largeur,
              hauteur,
              axe,
              nomS,
              nomT,
              wrapS,
              wrapT,
              u,
              v,
              eprouve,
              frontiere: surFrontiere(t, taille),
              attendu: [texelThree(u, largeur, wrapS), texelThree(v, hauteur, wrapT)],
            });
          }
    }
  return out;
}

/**
 * Le décompte des écarts d'une comparaison, composante par composante : l'axe éprouvé par mode et
 * par frontière, l'axe fixé à 1,3 par mode. `ecart(c, k)` rend `null` ou un exemple lisible.
 */
export function bilan(nom, liste, ecart) {
  const lignes = {};
  const compte = (cle, e) => {
    lignes[cle] ??= { cas: 0, ecarts: 0, exemple: null };
    lignes[cle].cas++;
    if (!e) return;
    lignes[cle].ecarts++;
    lignes[cle].exemple ??= e;
  };
  for (const c of liste) {
    const k = c.axe === 'u' ? 0 : 1;
    compte(`${c.eprouve}${c.frontiere ? ' (frontière)' : ''}`, ecart(c, k));
    compte(`${k ? c.nomS : c.nomT} (axe fixé)`, ecart(c, 1 - k));
  }
  console.log(`\n${nom}`);
  for (const [cle, l] of Object.entries(lignes).sort())
    console.log(
      `  ${cle.padEnd(28)} ${String(l.ecarts).padStart(4)} écarts / ${l.cas}${l.exemple ? `  ex. ${l.exemple}` : ''}`,
    );
  return lignes;
}

/** Les écarts des lignes d'un bilan que `retenue(cle)` compte comme bloquantes. */
export const somme = (lignes, retenue = () => true) =>
  Object.entries(lignes).reduce((n, [cle, l]) => n + (retenue(cle) ? l.ecarts : 0), 0);
