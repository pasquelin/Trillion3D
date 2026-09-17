/**
 * Côté page de la mesure des lancements : la VRAIE coupe du moteur — `createDagResources` et
 * `encodeDagKernels` — contre la coupe d'avant, recopiée dans `oracles/coupe-lancements.mjs`.
 * Empaqueté par esbuild puis exécuté dans Chromium, comme `cameraParenteeGpuPage.mjs`.
 *
 * Le côté livré n'est pas réécrit ici. C'est la seule façon de mesurer ce qu'une image coûte
 * vraiment : un encodeur recopié à la main mesure la copie, et l'écart avec l'original ne se voit
 * jamais. Seul l'oracle est écrit à la main, parce qu'il n'existe plus.
 *
 * Ce que la carte paie entre deux noyaux ne se compte pas en fils mais en COMMANDES : chaque passe de
 * calcul et chaque copie hors passe ferment l'encodeur courant et en ouvrent un autre. Le banc
 * mesure donc la SUITE ENTIÈRE d'une image, jamais un noyau isolé, et alterne les variantes pour que
 * la dérive thermique tombe des deux côtés.
 */
import { createDagResources } from '../../packages/sdk-browser/gpuDagResources.ts';
import { encodeDagKernels } from '../../packages/sdk-browser/gpuDagEncode.ts';
import { packedWorldsToRenderOrigin } from '../../packages/sdk-browser/gpuDagPack.ts';
import * as THREE from 'three';
import {
  cameraSelectionUniforms,
  SELECTION_UNIFORM_BYTES,
} from '../../packages/sdk-browser/gpuSelection.ts';
import { writeDagUniforms } from '../../packages/sdk-browser/gpuDagUniforms.ts';
import { SELECTION_HEADER_WORDS } from '../../packages/sdk-browser/gpuDagLayout.ts';
import { DAG_SELECTION_SHADER } from '../../packages/sdk-browser/gpuDagShader.ts';
import { DAG_LEVEL_WGSL } from '../../packages/sdk-browser/gpuDagLevelWgsl.ts';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';
import {
  DAG_LEVEL_WGSL_AVANT,
  encodeAvant,
  ressourcesAvant,
} from '../../packages/sdk-browser/bench/oracles/coupe-lancements.mjs';
import { ouvrirAppareil } from './appareilWebgpu.mjs';
import { commandes, mediane, scene } from './coupeLancementsDecor.mjs';

const SHADER_AVANT = DAG_SELECTION_SHADER.replace(DAG_LEVEL_WGSL, DAG_LEVEL_WGSL_AVANT);

export async function executer({ feuilles, niveaux, profondeurs, tours, rondes, bornes }) {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const { packed, roots } = scene(feuilles, niveaux);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
  camera.position.set(0, 0, 16);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const uniforms = cameraSelectionUniforms(cameraMoteur(camera), 1, [1280, 720]);
  packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld);

  // Le côté livré : ses tampons, ses étapes, son encodage. Rien n'en est réécrit.
  const livre = await createDagResources(device, packed, true);
  if (!livre) return { indisponible: 'la coupe livrée ne se monte pas' };
  const { module, compilation } = await appareil.compile(SHADER_AVANT);
  if (compilation.length) return { compilation, erreurs };
  const avant = ressourcesAvant(device, module, livre.layout, packed, livre.readbackBytes);

  const uni = new Float32Array(SELECTION_UNIFORM_BYTES / 4);
  writeDagUniforms(uni, packed, uniforms, true);
  device.queue.writeBuffer(livre.uniforms, 0, uni);
  device.queue.writeBuffer(avant.uniforms, 0, uni);

  const lecture = device.createBuffer({
    size: livre.readbackBytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const relire = async (sortie) => {
    const copie = device.createCommandEncoder();
    copie.copyBufferToBuffer(sortie, 0, lecture, 0, livre.readbackBytes);
    device.queue.submit([copie.finish()]);
    await lecture.mapAsync(GPUMapMode.READ);
    const ints = new Uint32Array(lecture.getMappedRange().slice(0));
    lecture.unmap();
    const tete = livre.outputBytes / 4;
    const entete = SELECTION_HEADER_WORDS;
    const liste = (at) =>
      Array.from(ints.subarray(at + entete, at + entete + Math.min(ints[at], packed.pageCount)));
    return {
      pages: liste(0).sort((a, b) => a - b),
      dessinees: liste(tete),
      frustumRejected: ints[1],
      overflow: ints[3],
    };
  };

  /**
   * Un lot d'images, et les DEUX temps qu'il faut séparer : celui que le processeur passe à écrire
   * les commandes, et celui qu'on attend encore une fois la dernière soumise. Les confondre
   * attribuerait au GPU un encodage processeur, ce qui n'est pas la même dépense.
   */
  const lot = async (encode, nombre) => {
    const debut = performance.now();
    for (let image = 0; image < nombre; image++) {
      const encoder = device.createCommandEncoder();
      encode(encoder);
      device.queue.submit([encoder.finish()]);
    }
    const ecrit = performance.now();
    await device.queue.onSubmittedWorkDone();
    return { encodage: (ecrit - debut) / nombre, total: (performance.now() - debut) / nombre };
  };

  // Les étages sur lesquels la descente livrée se lance à plat. Les allonger ne change aucun verdict
  // — les fils de trop sortent sur la garde de compte — et donne la profondeur que l'on veut.
  const etages = (profondeur, largeur) =>
    Uint32Array.from({ length: profondeur }, (_, l) =>
      l < packed.levelSizes.length ? Math.max(packed.levelSizes[l], largeur) : largeur,
    );
  const variantes = [
    {
      nom: 'avant (deux files, niveau indirect et armé)',
      sortie: avant.output,
      encode: (e, p) => encodeAvant(e, avant, p),
    },
    {
      nom: 'après (la coupe livrée, descente à plat en une passe)',
      sortie: livre.output,
      encode: (e, p) => encodeDagKernels(e, { ...livre, levelSizes: etages(p, 0) }),
    },
  ];

  // La profondeur de la scène d'abord, puis celles qu'on allonge : les étages de trop sont vides.
  const toutes = [packed.levelSizes.length, ...profondeurs];
  const comptes = variantes.map((v) => toutes.map((p) => commandes((e) => v.encode(e, p))));
  const mesures = variantes.map(() => toutes.map(() => []));
  for (let ronde = 0; ronde < rondes; ronde++)
    for (let v = 0; v < variantes.length; v++)
      for (let p = 0; p < toutes.length; p++) {
        const encode = (e) => variantes[v].encode(e, toutes[p]);
        await lot(encode, Math.max(2, tours >> 2));
        mesures[v][p].push(await lot(encode, tours));
      }
  const sorties = [];
  for (const variante of variantes) {
    await lot((e) => variante.encode(e, packed.levelSizes.length), 1);
    sorties.push({ nom: variante.nom, ...(await relire(variante.sortie)) });
  }

  // Le garde-fou : la descente livrée lancée sur des étages de plus en plus larges, la scène
  // inchangée. C'est le prix des fils qui sortent aussitôt, et la marge qui reste avant que le
  // lancement à plat ne redevienne plus cher que l'armement qu'il remplace.
  const balayage = [];
  for (const largeur of bornes) {
    const encode = (e) =>
      encodeDagKernels(e, { ...livre, levelSizes: etages(packed.levelSizes.length, largeur) });
    await lot(encode, Math.max(2, tours >> 2));
    const releve = [];
    for (let ronde = 0; ronde < rondes; ronde++) releve.push(await lot(encode, tours));
    balayage.push({
      borneParNiveau: largeur,
      ms: Number(mediane(releve.map((m) => m.total)).toFixed(4)),
      sortie: await relire(livre.output),
    });
  }

  const info = await appareil.fermer();
  return {
    adaptateur: info.court,
    erreurs,
    pages: packed.pageCount,
    noeuds: packed.nodeCount,
    profondeurLivree: packed.levelSizes.length,
    profondeurs: toutes,
    etagesLivres: Array.from(packed.levelSizes),
    noms: variantes.map((v) => v.nom),
    comptes,
    mesures,
    sorties,
    balayage,
  };
}
