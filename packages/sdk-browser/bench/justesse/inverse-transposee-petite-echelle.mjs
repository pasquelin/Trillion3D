// Défaut 6 : dans `inverseTranspose3` (gpuDagShader.ts), le garde `abs(det)<1e-20` rendait l'axe
// LOCAL non transformé au lieu de l'inverse-transposée dès qu'une échelle uniforme assez petite
// (det = ±s³ < 1e-20, soit s ≲ 2,15e-7) rendait le déterminant minuscule. Le test de conformité
// (défaut 1) étant, lui, indépendant de l'échelle, une rotation d'échelle minuscule était jugée
// conforme des deux côtés et seul le GPU prenait le raccourci : il comparait l'axe non tourné à la
// caméra comme s'il était déjà en repère monde, et supprimait des faces pourtant de face.
//
// Ce script exécute réellement le noyau WGSL dans Chromium WebGPU, deux fois sur les mêmes cas :
// la version corrigée telle qu'elle est livrée, et la version AVANT reconstruite en remettant le
// seuil absolu dans le même texte. Pour chaque cas il mesure la vérité terrain (vrais sommets
// transformés), la décision CPU réelle et les deux décisions GPU, puis vérifie en dur que la
// correction supprime le défaut sans rien changer hors de la bande du seuil.
//
// LAB_ROOT=… node --experimental-strip-types \
//   packages/sdk-browser/bench/justesse/inverse-transposee-petite-echelle.mjs
import assert from 'node:assert/strict';
import { cameraSelectionUniforms } from '../../gpuSelection.ts';
import { packDagSelection } from '../../gpuDagSelection.ts';
import { DAG_SELECTION_SHADER } from '../../gpuDagShader.ts';
import {
  camera,
  VIEWPORT,
  dansLeChamp,
  decisionCpu,
  veriteTerrain,
} from './inverseTransposeCas.mjs';
import { DETERMINISTES, HORS_BANDE, SCALES, tousLesCas } from './inverseTransposeEchantillon.mjs';
import { selectionGpu } from './noyauSelectionGpu.mjs';

// --- Le texte d'avant le lot, reconstruit dans le shader livré ----------------------------------
const CORRIGE = ` let w=abs(m[0])+abs(m[1])+abs(m[2]);let t=w.x+w.y+w.z;
 if(!(t>0.0)||(bitcast<u32>(t)&0x7f800000u)==0x7f800000u){return v;}
 let a=m[0]/t;let b=m[1]/t;let c=m[2]/t;
 let det=dot(a,cross(b,c));
 if(!(abs(det)>1e-20)){return v;}
 return (1.0/(det*t))*(mat3x3f(cross(b,c),cross(c,a),cross(a,b))*v);`;
const AVANT = ` let a=m[0];let b=m[1];let c=m[2];
 let det=dot(a,cross(b,c));
 if(abs(det)<1e-20){return v;}
 return (1.0/det)*(mat3x3f(cross(b,c),cross(c,a),cross(a,b))*v);`;
const SHADER_AVANT = DAG_SELECTION_SHADER.replace(CORRIGE, AVANT);
assert.notEqual(SHADER_AVANT, DAG_SELECTION_SHADER, 'le texte corrigé n’a pas été retrouvé');

// --- CPU et vérité terrain, un passage JS ordinaire ---------------------------------------------
const verites = tousLesCas.map(veriteTerrain);
const cpus = tousLesCas.map(decisionCpu);
const champs = tousLesCas.map(dansLeChamp);

// --- GPU réellement exécuté, un seul lot de dispatch par version --------------------------------
const uniforms = cameraSelectionUniforms(camera, 0, VIEWPORT);
const packed = packDagSelection(
  tousLesCas.map((cas) => ({
    world: cas.world,
    pages: [
      {
        url: '0',
        lodError: 0,
        parentError: null,
        sphere: [0, 0, 0, cas.worldSize],
        min: cas.min,
        max: cas.max,
        cone: cas.cone,
      },
    ],
  })),
);

/** Les pages rejetées par le noyau WGSL, pour un texte de shader donné. */
async function rejetsGpu(shader) {
  const gpu = await selectionGpu([{ nom: 'lot', packed, uniforms }], shader);
  assert.equal(gpu.indisponible ?? null, null, `GPU indisponible : ${gpu.indisponible}`);
  assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], [], 'WGSL');
  const gardees = new Set(gpu.resultats.find((r) => r.nom === 'lot').pages);
  return { adaptateur: gpu.adaptateur, rejets: tousLesCas.map((_, i) => !gardees.has(i)) };
}

const avant = await rejetsGpu(SHADER_AVANT);
const apres = await rejetsGpu(DAG_SELECTION_SHADER);

// --- Classement ---------------------------------------------------------------------------------
// Une face avant réellement visible supprimée par le GPU est le défaut ; le reste sert de témoin.
const supprime = (rejets) =>
  tousLesCas.map((_, i) => i).filter((i) => verites[i].avantVisible && rejets[i]);
const suppressionsAvant = supprime(avant.rejets);
const suppressionsApres = supprime(apres.rejets);
const changements = tousLesCas.map((_, i) => i).filter((i) => avant.rejets[i] !== apres.rejets[i]);
const parEchelle = Object.fromEntries(
  SCALES.map((s) => {
    const idx = tousLesCas.map((cas, i) => (cas.s === s ? i : -1)).filter((i) => i >= 0);
    const compte = (liste) => liste.filter((i) => tousLesCas[i].s === s).length;
    return [
      s,
      {
        cas: idx.length,
        suppressionsAvant: compte(suppressionsAvant),
        suppressionsApres: compte(suppressionsApres),
        selectionsChangees: compte(changements),
      },
    ];
  }),
);

// Les suppressions qui restent après le lot : toutes des réflexions (déterminant négatif), que le
// CPU supprime aussi, à toute échelle. Ce ne sont PAS des faces visibles : `veriteTerrain` ignore
// que le moteur échange la face éliminée sous réflexion, et le lot du défaut 10 a mesuré, GPU
// réellement exécuté, que le moteur n'en dessine aucune — voir `reflexion-cone.mjs`.
const residus = {
  total: suppressionsApres.length,
  miroirs: suppressionsApres.filter((i) => tousLesCas[i].miroir).length,
  cpuRejetteAussi: suppressionsApres.filter((i) => cpus[i].coneRejette).length,
  echelles: [...new Set(suppressionsApres.map((i) => tousLesCas[i].s))],
};

console.log(
  JSON.stringify(
    {
      adaptateurGpu: apres.adaptateur,
      totalCas: tousLesCas.length,
      suppressionsAvant: suppressionsAvant.length,
      suppressionsApres: suppressionsApres.length,
      selectionsChangees: changements.length,
      parEchelle,
      residus,
      contreExemple: {
        scale: DETERMINISTES[0][1].s,
        rotation: { axis: DETERMINISTES[0][1].axis, angleDeg: DETERMINISTES[0][1].angleDeg },
        matrice: [...DETERMINISTES[0][1].world.elements],
        coneLocal: DETERMINISTES[0][1].cone,
        dansLeChamp: champs[0],
        verite: verites[0],
        cpu: cpus[0],
        gpuAvant: avant.rejets[0],
        gpuApres: apres.rejets[0],
      },
      temoins: DETERMINISTES.slice(1).map(([nom], k) => ({
        nom,
        verite: verites[k + 1].avantVisible,
        cpuRejette: cpus[k + 1].coneRejette,
        gpuAvant: avant.rejets[k + 1],
        gpuApres: apres.rejets[k + 1],
      })),
    },
    null,
    2,
  ),
);

// --- Le contre-exemple : le défaut, puis sa disparition ------------------------------------------
assert.ok(champs[0], 'le contre-exemple doit être dans le champ');
assert.ok(
  verites[0].triangles.every((t) => t.face > 0.5 && t.airePixels > 100),
  'les deux triangles doivent être nettement de face et de taille notable',
);
assert.equal(cpus[0].conforme, true, 'CPU : la transformation doit être jugée conforme');
assert.equal(cpus[0].rejette, false, 'CPU : selectVisiblePages doit garder les 2 triangles');
assert.equal(avant.rejets[0], true, 'avant le lot : le noyau WGSL supprimait le cluster visible');
assert.equal(apres.rejets[0], false, 'après le lot : le noyau WGSL garde le cluster visible');
assert.ok(suppressionsAvant.length > 0, 'le défaut doit être observé avant le lot');

// --- Ce que le lot ne doit pas changer -----------------------------------------------------------
assert.deepEqual(
  changements.filter((i) => HORS_BANDE.includes(tousLesCas[i].s)),
  [],
  'hors de la bande du seuil (det ≥ 1e-20), aucune sélection ne doit changer',
);
assert.equal(
  residus.total,
  residus.miroirs,
  'toute suppression restante doit être une réflexion, que le moteur ne dessine pas (défaut 10)',
);
assert.equal(residus.total, residus.cpuRejetteAussi, 'et le CPU doit la supprimer aussi');
assert.equal(apres.rejets[1], false, 'témoin grande échelle : det ≫ 1e-20, le GPU garde');
assert.equal(verites[2].avantVisible, false, 'témoin sans rotation : les faces sont bien de dos');
assert.equal(apres.rejets[2], true, 'témoin sans rotation : le rejet légitime doit être conservé');
assert.equal(
  apres.rejets[3],
  false,
  'témoin non conforme : jamais rejeté, quelle que soit la rotation',
);

console.error(
  `Verdict : défaut 6 RÉEL — ${suppressionsAvant.length}/${tousLesCas.length} faces visibles ` +
    `supprimées avant le lot, ${suppressionsApres.length} après (toutes des réflexions, que le ` +
    `moteur ne dessine pas : voir reflexion-cone.mjs), 0 sélection changée hors bande. ` +
    `Adaptateur ${apres.adaptateur}.`,
);
