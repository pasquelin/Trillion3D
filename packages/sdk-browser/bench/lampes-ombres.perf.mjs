// ce que les ombres des lampes coûtent au processeur : les sphères monde des clusters empaquetées
// pour la passe d'ombres, la couverture écran qui classe les lampes, et le plan des faces à
// redessiner quand la scène bouge.
import { screenCoverage } from '../../sdk-core/sceneLightShadowCounts.ts';
import { createSceneLightStore } from '../../sdk-core/sceneLightStore.ts';
import { createShadowPlan } from '../../sdk-core/sceneLightShadowPlan.ts';
import { packClusterSpheres } from '../webgpuShadowBounds.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { referenceClusterSphere, referenceScreenCoverage } from './oracles/lampes-ombres.mjs';

const alea = graine(83);

// Une ligne sur dix est vide : la passe doit y écrire un rayon nul, jamais lire une fiche absente.
// Le tampon de sortie est celui du cas, alloué une fois, comme le moteur tient le sien.
function clusters(nombre) {
  const recs = [];
  for (let i = 0; i < nombre; i++) {
    const elements = new Float64Array(16);
    for (let j = 0; j < 16; j++) elements[j] = (alea() - 0.5) * 10;
    const min = [(alea() - 0.5) * 5, (alea() - 0.5) * 5, (alea() - 0.5) * 5];
    const max = [min[0] + alea() * 5, min[1] + alea() * 5, min[2] + alea() * 5];
    recs.push(i % 10 === 9 ? undefined : { matrix: { elements }, min, max });
  }
  return { recs, packed: new Float32Array(nombre * 4) };
}

const mesSpheres = await mesure({
  nom: 'sphères monde des clusters',
  fichier: 'packages/sdk-browser/webgpuShadowBounds.ts',
  cas: [
    { nom: '20 000 clusters', entree: clusters(20000), taille: 20000 },
    { nom: '1 cluster', entree: clusters(1), taille: 1 },
    { nom: 'aucun', entree: clusters(0), taille: 0 },
  ],
  calcul: ({ recs, packed }) => packClusterSpheres(recs, packed, 0, recs.length - 1),
  attendu: ({ recs }) => {
    const sortie = new Float32Array(recs.length * 4);
    recs.forEach((rec, i) => rec && referenceClusterSphere(rec, sortie, i * 4));
    return sortie;
  },
});

const vue = { position: [0, 0, 0], forward: [0, 0, -1], far: 1000, halfFovY: Math.PI / 4 };

const lampes = (nombre) => ({
  liste: Array.from({ length: nombre }, () => ({
    x: (alea() - 0.5) * 100,
    y: (alea() - 0.5) * 100,
    z: (alea() - 0.5) * 100,
    range: alea() * 50,
  })),
  sortie: new Float64Array(nombre),
});

const couverture =
  (calcule) =>
  ({ liste, sortie }) => {
    for (let i = 0; i < liste.length; i++) {
      const l = liste[i];
      sortie[i] = calcule(vue, l.x, l.y, l.z, l.range);
    }
    return sortie;
  };

const mesCouverture = await mesure({
  nom: "couverture écran d'une lampe",
  fichier: 'packages/sdk-core/sceneLightShadowCounts.ts',
  cas: [
    { nom: '10 000 lampes', entree: lampes(10000), taille: 10000 },
    { nom: '1 lampe', entree: lampes(1), taille: 1 },
  ],
  calcul: couverture(screenCoverage),
  attendu: couverture(referenceScreenCoverage),
});

function scene(nombre) {
  const store = createSceneLightStore();
  for (let i = 0; i < nombre; i++)
    store.add({
      id: `light-${i}`,
      kind: 'point',
      position: [(alea() - 0.5) * 50, alea() * 10, (alea() - 0.5) * 50],
      color: [1, 1, 1],
      intensity: 100,
      range: 20,
      castsShadow: true,
    });
  return { store, plan: createShadowPlan(nombre), frame: 0 };
}

// À chaque image, un nœud bouge dans la portée des lampes : l'invalidation et l'admission
// travaillent. Une scène immobile ne coûterait rien, et ce serait le chiffre publié.
const mesOrdonnancement = await mesure({
  nom: "plan des faces d'ombre",
  fichier: 'packages/sdk-core/sceneLightShadowPlan.ts',
  cas: [{ nom: '32 lampes, scène mobile', entree: scene(32), taille: 32 }],
  calcul: (s) => {
    s.frame++;
    const x = (s.frame % 40) - 20;
    s.plan.worldChanged([x, 0, x], [x + 2, 2, x + 2]);
    return s.plan.plan(s.store, vue, s.frame, s.frame * 16.6);
  },
  motif: "justesse tenue par sceneLightShadowPlan.test.ts, l'oracle serait un second ordonnanceur",
});

await stress({
  nom: 'couverture écran extrême',
  calcul: ([x, y, z, range]) => screenCoverage(vue, x, y, z, range),
  extremes: [
    { nom: 'portée nulle', entree: [0, 0, 0, 0] },
    { nom: 'portée infinie', entree: [0, 0, 0, Infinity] },
    { nom: "sur l'œil", entree: [0, 0, 0, 10] },
    { nom: 'NaN', entree: [NaN, NaN, NaN, 10] },
  ],
});

rapport(
  'lampes-ombres',
  [mesSpheres, mesCouverture, mesOrdonnancement],
  'les sphères et la couverture rendent les mêmes valeurs',
);
