// Les lots du banc de performance du socle : `n` poses ordinaires du moteur tenues des deux façons —
// objets de la référence et tampons du socle — avec leurs sorties déjà allouées de chaque côté.
import * as THREE from 'three';
import { graine } from '../../sdk-core/bench/mesure.mjs';
import { f64 } from './socleLigne.mjs';

const alea = graine(0xbe5c);
/** Une pose ordinaire du moteur : rotation quelconque, échelle positive non uniforme. */
function pose() {
  const q = new THREE.Quaternion(
    alea() - 0.5,
    alea() - 0.5,
    alea() - 0.5,
    alea() - 0.5,
  ).normalize();
  const p = new THREE.Vector3(alea() * 100, alea() * 100, alea() * 100);
  const s = new THREE.Vector3(0.5 + alea(), 0.5 + alea(), 0.5 + alea());
  return new THREE.Matrix4().compose(p, q, s);
}
export const vueProjection = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000).projectionMatrix;

/** `n` matrices tenues des deux façons, et les sorties de chaque côté. */
export function lot(n) {
  const three = Array.from({ length: n }, pose);
  const trs = three.map((m) => {
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3();
    m.decompose(p, q, s);
    return { p, q, s, pa: f64(p.toArray()), qa: f64(q.toArray()), sa: f64(s.toArray()) };
  });
  // Rangement « tampon plat, sous-vues » : un seul `Float64Array` de seize × `n` nombres, et des
  // sous-vues dessus — c'est ainsi que le moteur range ses matrices monde (`tree.world` +
  // `tree.worldViews`, `mathTransformTree.ts`), à côté du rangement « une Float64Array par élément »
  // ci-dessus (`socle`/`tampons4`), publié sans être retiré.
  const socleTampon = new Float64Array(n * 16),
    tamponsTampon = new Float64Array(n * 16);
  const vues = (tampon) =>
    Array.from({ length: n }, (_, i) => tampon.subarray(i * 16, i * 16 + 16));
  const socleVues = vues(socleTampon),
    tamponsVues = vues(tamponsTampon);
  for (let i = 0; i < n; i++) socleVues[i].set(f64(three[i].elements));

  const l = {
    trs,
    three,
    socle: three.map((m) => f64(m.elements)),
    socleTampon,
    socleVues,
    tamponsTampon,
    tamponsVues,
    sortie4: Array.from({ length: n }, () => new THREE.Matrix4()),
    sortie3: Array.from({ length: n }, () => new THREE.Matrix3()),
    tampons4: Array.from({ length: n }, () => new Float64Array(16)),
    tampons3: Array.from({ length: n }, () => new Float64Array(9)),
    points: Array.from({ length: n }, () => [alea() * 50, alea() * 50, alea() * 50]),
    vecteurs: Array.from({ length: n }, () => new THREE.Vector3()),
    parents: Array.from({ length: n }, (_, i) => (i ? Math.floor(alea() * i) : -1)),
  };
  // La racine des matrices monde est la même pose des deux côtés : les produits portent les mêmes valeurs.
  l.sortie4[0].copy(three[0]);
  l.tampons4[0].set(l.socle[0]);
  l.tamponsVues[0].set(l.socleVues[0]);
  return l;
}
