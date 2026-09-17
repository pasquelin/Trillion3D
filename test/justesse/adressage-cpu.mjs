// Défaut 4, côté processeur : le vrai `wrapTexel`, la vraie lecture `sampleLinear` et le vrai
// raster de visibilité (test alpha) contre la règle de Three, sur tous les cas d'`adressageCas`.
// Défaut 7 : `wrapLinear`, le miroir processeur de la règle d'adressage du nuanceur, contre la
// règle entière de l'échantillonneur en filtrage linéaire — la couture d'une période comprise.
// Défaut 8 : un matériau dont les six cartes n'ont pas le même mode. Le chemin processeur lit le
// mode dans la texture qu'il échantillonne (`texelAt`), pas dans un drapeau de matériau : on le
// compte carte par carte plutôt que de le déduire de la lecture du code.
//   node --experimental-strip-types test/justesse/adressage-cpu.mjs [sortie.json]
// Code de retour 1 au premier écart. `sortie.json` reçoit les texels lus, pour comparer deux commits.
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { sampleLinear, wrapTexel } from '../../packages/sdk-browser/visibilityMath.ts';
import { wrapLinear } from '../../packages/sdk-browser/visibilityWrapModes.ts';
import { rasterVisibility } from '../../packages/sdk-browser/visibilityRaster.ts';
import {
  bilan,
  cas,
  lineaireThree,
  melange,
  octetsTexture,
  somme,
  texelThree,
} from './adressageCas.mjs';
import { CARTES, materielMelange, TEXTURE, UV } from './adressageCartes.mjs';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';

const textures = new Map();
function carte(c) {
  const cle = `${c.largeur}x${c.hauteur}/${c.wrapS}/${c.wrapT}`;
  if (!textures.has(cle)) {
    const map = new THREE.Texture();
    map.image = { data: octetsTexture(c.largeur, c.hauteur), width: c.largeur, height: c.hauteur };
    map.wrapS = c.wrapS;
    map.wrapT = c.wrapT;
    map.flipY = false;
    textures.set(cle, map);
  }
  return textures.get(cle);
}

/**
 * Le texel que le raster retient : un triangle dont le sommet `a` tombe exactement sur le pixel
 * (0, 0), où les poids valent (1, 0, 0), porte la coordonnée du cas telle quelle. L'alpha d'un
 * texel vaut 10 + 10·rang ; la dichotomie sur `alphaTest` retrouve le rang du texel lu.
 */
const camera = new THREE.PerspectiveCamera();
camera.projectionMatrix.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.5, 0, 0, -1, 0);
const positions = new THREE.Float32BufferAttribute([-1, 1, -1, 3, 1, -1, -1, -3, -1], 3);
function texelRaster(c) {
  const geometrie = new THREE.BufferGeometry();
  geometrie.setAttribute('position', positions);
  geometrie.setAttribute('uv', new THREE.Float32BufferAttribute([c.u, c.v, c.u, c.v, c.u, c.v], 2));
  const materiau = new THREE.MeshBasicMaterial({ map: carte(c), side: THREE.DoubleSide });
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: geometrie.attributes,
    matrix: new THREE.Matrix4(),
    material: materiau,
  };
  const garde = (rang) => {
    materiau.alphaTest = (10 + 10 * rang) / 255;
    return rasterVisibility([page], cameraMoteur(camera), [1, 1]).ids[0] !== 0;
  };
  if (!garde(0)) return null;
  let bas = 0,
    haut = c.largeur * c.hauteur - 1;
  while (bas < haut) {
    const milieu = (bas + haut + 1) >> 1;
    if (garde(milieu)) bas = milieu;
    else haut = milieu - 1;
  }
  return [bas % c.largeur, Math.floor(bas / c.largeur)];
}

const tous = cas();
const lus = tous.map((c, rang) => {
  c.rang = rang;
  const [r, g] = sampleLinear(carte(c), c.u, c.v);
  return {
    wrapTexel: [wrapTexel(c.u, c.largeur, c.wrapS), wrapTexel(c.v, c.hauteur, c.wrapT)],
    sampleLinear: [Math.round((r * 255 - 20) / 40), Math.round((g * 255 - 20) / 40)],
    raster: texelRaster(c),
  };
});
const ecart = (chemin) => (c, k) => {
  const lu = lus[c.rang][chemin];
  return lu && lu[k] === c.attendu[k]
    ? null
    : `${c.largeur}x${c.hauteur} S=${c.nomS} T=${c.nomT} uv=(${c.u}, ${c.v}) Three=${c.attendu} lu=${lu}`;
};
let ecarts = 0;
for (const chemin of ['wrapTexel', 'sampleLinear', 'raster'])
  ecarts += somme(bilan(`CPU ${chemin} contre Three (${tous.length} cas)`, tous, ecart(chemin)));

/**
 * Défaut 7 : la couleur que le filtrage linéaire doit rendre sur l'axe éprouvé, les deux texels de
 * la règle mêlés en double précision, contre ceux que `wrapLinear` désigne. Les deux calculs
 * partent de la même coordonnée 32 bits, donc leur accord est exact et non approché.
 */
const lineaire = (c, k) => {
  const t = k ? c.v : c.u,
    taille = k ? c.hauteur : c.largeur,
    wrap = k ? c.wrapT : c.wrapS;
  const lu = melange(wrapLinear(t, taille, wrap)),
    attendu = melange(lineaireThree(t, taille, wrap));
  return Math.abs(lu - attendu) <= 1e-9
    ? null
    : `${c.largeur}x${c.hauteur} S=${c.nomS} T=${c.nomT} uv=(${c.u}, ${c.v}) règle=${attendu} lu=${lu}`;
};
ecarts += somme(
  bilan(`CPU wrapLinear contre la règle de l'échantillonneur (${tous.length} cas)`, tous, lineaire),
);

/**
 * Défaut 8, processeur : chaque carte du matériau mixte, lue par la vraie `sampleLinear`, contre le
 * texel de la règle dans le mode de cette carte-là. Zéro écart attendu de part et d'autre du lot :
 * le défaut n'existe que sur le chemin carte graphique, où le mot d'adressage voyageait à part.
 */
const materiau = materielMelange();
const image = {
  data: octetsTexture(TEXTURE.largeur, TEXTURE.hauteur),
  width: TEXTURE.largeur,
  height: TEXTURE.hauteur,
};
console.log('\nDéfaut 8 : chaque carte du matériau mixte, lue par sampleLinear (processeur)');
for (const { nom, champ, wrapS, wrapT } of CARTES) {
  const map = Object.assign(materiau[champ], { image, flipY: false });
  let ecartsCarte = 0;
  for (const [u, v] of UV) {
    const [r, g] = sampleLinear(map, u, v);
    const lu = [Math.round((r * 255 - 20) / 40), Math.round((g * 255 - 20) / 40)];
    const attendu = [texelThree(u, TEXTURE.largeur, wrapS), texelThree(v, TEXTURE.hauteur, wrapT)];
    if (lu[0] !== attendu[0] || lu[1] !== attendu[1]) ecartsCarte++;
  }
  ecarts += ecartsCarte;
  console.log(`  ${nom.padEnd(10)} ${String(ecartsCarte).padStart(3)} écarts / ${UV.length}`);
}

/** Pour mémoire : `Texture.transformUv`, la règle processeur de Three, contredit sa propre
 *  carte graphique sur les frontières ; elle n'est pas la référence, on compte seulement. */
const transformUv = (c, k) => {
  const uv = carte(c).transformUv(new THREE.Vector2(c.u, c.v));
  const lu = [
    Math.min(c.largeur - 1, Math.floor(uv.x * c.largeur)),
    Math.min(c.hauteur - 1, Math.floor(uv.y * c.hauteur)),
  ];
  return lu[k] === c.attendu[k] ? null : `${c.nomS}/${c.nomT} uv=(${c.u}, ${c.v}) lu=${lu}`;
};
bilan('Pour mémoire, Texture.transformUv contre la carte graphique', tous, transformUv);

if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(lus));
console.log(`\nCPU : ${ecarts} écarts sur ${tous.length * 8} composantes lues`);
process.exitCode = ecarts ? 1 : 0;
