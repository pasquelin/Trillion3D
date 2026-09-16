// Justesse de l'erreur écran hors axe : un cluster simplifié accepté à tort au seuil 0,4 px.
//
// Un triangle fin placé hors axe, centre de vue (8, 0, −10), et son remplaçant grossier : le même
// triangle déplacé verticalement de ε. ε est choisi pour que l'ancienne formule annonce 0,39 px ;
// le vrai déplacement écran des sommets est de 0,5 px. Au seuil 0,4 px, la coupe doit donc garder
// le triangle fin. Le script interroge la vraie coupe CPU (`selectVisiblePages`, à plat et avec un
// nœud de culling et ses bornes), l'oracle Node du noyau et le noyau WGSL réellement exécuté dans
// Chromium WebGPU, puis échoue si l'un d'eux retient le grossier.
//
// node --experimental-strip-types packages/sdk-browser/bench/justesse/erreur-ecran-hors-axe.mjs
// (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { selectVisiblePages } from '../../pageSelectionCut.ts';
import { projectedClusterError } from '../../pageSelectionMath.ts';
import { cullingBounds } from '../../pageSelectionCutBounds.ts';
import { cameraSelectionUniforms } from '../../gpuSelection.ts';
import { evaluateDagSelectionKernel, packDagSelection } from '../../gpuDagSelection.ts';
import { selectionGpu } from './noyauSelectionGpu.mjs';
import { cameraMoteur } from '../../cameraFixture.ts';

const SEUIL = 0.4;
const VIEWPORT = [1920, 1080];
const camera = new THREE.PerspectiveCamera(60, VIEWPORT[0] / VIEWPORT[1], 0.1, 1000);
camera.updateMatrixWorld(true);
const world = new THREE.Matrix4();
const focal = (VIEWPORT[1] * camera.projectionMatrix.elements[5]) / 2;

const fin = [8, 0, -10, 8.01, 0, -10, 8, 0.01, -10];
/** Sphère englobante d'une liste de sommets : centre de la boîte, rayon au sommet le plus loin. */
function sphereDe(sommets) {
  const box = new THREE.Box3().setFromArray(sommets);
  const c = box.getCenter(new THREE.Vector3());
  let r = 0;
  for (let i = 0; i < sommets.length; i += 3)
    r = Math.max(r, c.distanceTo(new THREE.Vector3().fromArray(sommets, i)));
  return { sphere: [c.x, c.y, c.z, r], min: box.min.toArray(), max: box.max.toArray() };
}
// ε tel que l'ancienne formule, `ε·f / (|C| − r)`, annonce 0,39 px pour la sphère du grossier.
const approche = sphereDe([...fin, 8, 0.006, -10]);
const [ax, ay, az, ar] = approche.sphere;
const EPS = (0.39 * (Math.hypot(ax, ay, az) - ar)) / focal;
const grossier = fin.map((v, i) => (i % 3 === 1 ? v + EPS : v));
const boiteFin = sphereDe(fin),
  boiteGrossier = sphereDe([...fin, ...grossier]);

/** Déplacement écran réel, en pixels, entre les sommets fins et grossiers. */
function reel() {
  let pire = 0;
  for (let i = 0; i < fin.length; i += 3) {
    const a = new THREE.Vector3().fromArray(fin, i).project(camera);
    const b = new THREE.Vector3().fromArray(grossier, i).project(camera);
    pire = Math.max(pire, Math.hypot((b.x - a.x) * VIEWPORT[0], (b.y - a.y) * VIEWPORT[1]) / 2);
  }
  return pire;
}

const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const page = (id, boite, lodError, parentError, parentSphere) => ({
  id,
  url: String(id),
  triangles: 1,
  depthLayer: 0,
  min: boite.min,
  max: boite.max,
  sphere: boite.sphere,
  lodError,
  parentError,
  parentSphere,
  matrix: world,
  material,
});
const pages = [
  page(0, boiteGrossier, EPS, null, null),
  page(1, boiteFin, 0, EPS, boiteGrossier.sphere),
];
/** Un nœud feuille qui range les deux clusters : boîte, sphère, remplaçant absent (−1). */
const nodes = new Float64Array(15);
nodes.set([...boiteGrossier.min, ...boiteGrossier.max, ...boiteGrossier.sphere, -1, 0, 0, 0, 2]);
const culling = { nodes, stride: 15 };

function coupeCpu(avecNoeud) {
  const root = { world, pages, cones: false };
  if (avecNoeud) root.culling = { ...culling, bounds: cullingBounds(culling, pages) };
  const { shown } = selectVisiblePages([root], cameraMoteur(camera), {
    pixelError: SEUIL,
    viewport: VIEWPORT,
  });
  return shown.map((rec) => (rec.id === 0 ? 'grossier' : 'fin'));
}
const nom = (ids) => ids.map((i) => (i === 0 ? 'grossier' : 'fin'));

const uniforms = cameraSelectionUniforms(cameraMoteur(camera), SEUIL, VIEWPORT);
const empaquete = (avecNoeud) =>
  packDagSelection([{ world, pages, culling: avecNoeud ? culling : undefined }]);
const aPlat = empaquete(false),
  avecNoeud = empaquete(true);
const gpu = await selectionGpu([
  { nom: 'aPlat', packed: aPlat, uniforms },
  { nom: 'avecNoeud', packed: avecNoeud, uniforms },
]);
const pagesGpu = (cas) => {
  const pagesLues = gpu.resultats?.find((r) => r.nom === cas)?.pages;
  return pagesLues ? nom(pagesLues) : null;
};
const rapport = {
  epsilon: EPS,
  focalePixels: focal,
  deplacementReelPixels: reel(),
  annonceCpuPixels: projectedClusterError(
    EPS,
    boiteGrossier.sphere,
    0,
    camera.matrixWorldInverse.elements,
    1,
    focal,
    camera.near,
  ),
  seuil: SEUIL,
  cpu: { aPlat: coupeCpu(false), avecNoeud: coupeCpu(true) },
  oracleNoyau: {
    aPlat: nom(evaluateDagSelectionKernel(aPlat, uniforms).pageIds),
    avecNoeud: nom(evaluateDagSelectionKernel(avecNoeud, uniforms).pageIds),
  },
  gpu: {
    adaptateur: gpu.adaptateur ?? null,
    erreurs: [...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])],
    indisponible: gpu.indisponible ?? null,
    aPlat: pagesGpu('aPlat'),
    avecNoeud: pagesGpu('avecNoeud'),
  },
};
console.log(JSON.stringify(rapport, null, 2));

assert.ok(rapport.deplacementReelPixels > SEUIL, 'le cas doit dépasser le seuil pour de vrai');
assert.equal(rapport.gpu.indisponible, null);
assert.deepEqual(rapport.gpu.erreurs, []);
assert.ok(rapport.annonceCpuPixels >= rapport.deplacementReelPixels, 'CPU : erreur sous-estimée');
for (const [cote, sorties] of Object.entries({
  cpu: rapport.cpu,
  oracleNoyau: rapport.oracleNoyau,
  gpu: rapport.gpu,
}))
  for (const cas of ['aPlat', 'avecNoeud'])
    assert.deepEqual(sorties[cas], ['fin'], `${cote} ${cas} : le grossier est accepté à tort`);
