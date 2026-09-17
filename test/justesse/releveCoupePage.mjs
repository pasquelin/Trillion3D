/**
 * Côté page de la mesure du RELEVÉ : ce qu'une image paie à rapatrier la coupe, sur la vraie coupe
 * du moteur (`createDagResources`, `encodeDagKernels`) et un vrai appareil.
 *
 * Le tampon de relevé est taillé sur le PIRE CAS — `16 + pageCount*4` pour la coupe voulue, autant
 * pour la coupe dessinable (`gpuDagResources.ts`) —, et la copie d'image en emporte la totalité. À
 * deux millions de grappes cela fait seize mégaoctets recopiés et mappés par image pour quelques
 * dizaines de milliers de numéros utiles. Le banc mesure les deux tailles de copie sur le MÊME
 * encodage de noyau : seule la taille de la copie change, donc l'écart est le prix du pire cas.
 *
 * La lecture est SÉRIALISÉE ici — copie, soumission, `mapAsync`, lecture —, là où le moteur la
 * double-tamponne : ce chiffre est le travail total d'une image, pas le blocage qu'elle subit.
 * `encodage` le sépare de ce que le processeur passe à écrire les commandes.
 */
import * as THREE from 'three';
import { createDagResources } from '../../packages/sdk-browser/gpuDagResources.ts';
import { encodeDagKernels } from '../../packages/sdk-browser/gpuDagEncode.ts';
import {
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../packages/sdk-browser/gpuDagPack.ts';
import {
  cameraSelectionUniforms,
  SELECTION_UNIFORM_BYTES,
} from '../../packages/sdk-browser/gpuSelection.ts';
import { writeDagUniforms } from '../../packages/sdk-browser/gpuDagUniforms.ts';
import {
  dagRecords,
  residentBase,
  residentWords,
  SELECTION_HEADER_WORDS,
} from '../../packages/sdk-browser/gpuDagLayout.ts';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';
import { ouvrirAppareil } from './appareilWebgpu.mjs';
import { scenePages, sceneRoots } from '../../packages/sdk-browser/gpuDagCutFrontierScene.ts';

const mediane = (valeurs) => [...valeurs].sort((a, b) => a - b)[valeurs.length >> 1];

/** La scène : une pyramide de niveaux, une pose, toutes les pages résidentes, vue de face. */
function scene(feuilles, niveaux) {
  const roots = sceneRoots(scenePages(feuilles, niveaux), [new THREE.Matrix4()], true);
  const packed = packDagSelection(roots);
  const debut = residentBase(packed.pageCount);
  dagRecords(packed).coldInts.fill(0xffffffff, debut, debut + residentWords(packed.pageCount));
  return { packed, roots };
}

export async function executer({ tailles, niveaux, tours, rondes, plafond, erreurs: seuils }) {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
  camera.position.set(0, 0, 16);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const lignes = [];
  for (const feuilles of tailles) {
    let ligne;
    try {
      ligne = await mesure(device, scene(feuilles, niveaux), camera, { tours, rondes, seuils });
    } catch (error) {
      lignes.push({ feuilles, refus: String(error?.message ?? error) });
      break;
    }
    lignes.push(ligne);
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, erreurs, plafond, lignes };
}

async function mesure(device, { packed, roots }, camera, { tours, rondes, seuils }) {
  const uniforms = cameraSelectionUniforms(cameraMoteur(camera), 1, [1280, 720]);
  packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld);
  const livre = await createDagResources(device, packed, true);
  if (!livre) throw new Error('la coupe livrée ne se monte pas');
  const uni = new Float32Array(SELECTION_UNIFORM_BYTES / 4);
  /** Le seuil d'écran de l'image : c'est lui qui décide la TAILLE DE LA COUPE, donc ce qu'un
   *  plafond peut perdre. La mesure de temps se fait au dernier posé. */
  const poseSeuil = (erreur) => {
    writeDagUniforms(uni, packed, { ...uniforms, pixelError: erreur }, true);
    device.queue.writeBuffer(livre.uniforms, 0, uni);
  };
  poseSeuil(1);

  // Le dimensionnement d'HIER, gardé comme point de mesure : l'entête plus `pageCount` rangs par
  // moitié, le pire cas d'une coupe qui retiendrait le catalogue entier. La production ne l'alloue plus (le plafond
  // l'a remplacé), mais le prix d'une copie ne dépend que de sa TAILLE : un tampon de même taille le
  // mesure fidèlement, et c'est le seul moyen de garder le « avant » reproductible.
  const octetsPireCas = 2 * (SELECTION_HEADER_WORDS * 4 + packed.pageCount * 4);
  const source = device.createBuffer({
    size: octetsPireCas,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const lecture = device.createBuffer({
    size: Math.max(octetsPireCas, livre.readbackBytes),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  /** Une image entière : les noyaux, la copie du relevé, puis sa lecture. */
  const image = async (octets, depuis = livre.output) => {
    const encoder = device.createCommandEncoder();
    encodeDagKernels(encoder, livre);
    if (octets) encoder.copyBufferToBuffer(depuis, 0, lecture, 0, octets);
    device.queue.submit([encoder.finish()]);
    if (!octets) return await device.queue.onSubmittedWorkDone();
    await lecture.mapAsync(GPUMapMode.READ);
    const ints = new Uint32Array(lecture.getMappedRange(0, octets));
    const tete = ints[0];
    lecture.unmap();
    return tete;
  };
  const lot = async (octets, nombre, depuis) => {
    const debut = performance.now();
    for (let i = 0; i < nombre; i++) await image(octets, depuis ?? livre.output);
    return { ms: (performance.now() - debut) / nombre };
  };

  // Le seuil d'écran balayé : la coupe qu'il retient dit à quel plafond une scène de cette taille
  // se heurte vraiment. Mesuré, jamais supposé.
  const coupes = [];
  for (const erreur of seuils) {
    poseSeuil(erreur);
    coupes.push({ erreur, coupe: await image(livre.readbackBytes) });
  }
  poseSeuil(seuils[seuils.length - 1]);
  // Trois variantes, dont une SANS relevé : c'est elle qui sépare le prix de la copie de celui du
  // noyau. Sans ce zéro, l'écart entre les deux autres se lirait sur un total que la coupe domine.
  const variantes = [
    { nom: 'aucun relevé (les noyaux seuls)', octets: 0 },
    { nom: 'relevé livré (plafonné)', octets: livre.readbackBytes },
    { nom: 'relevé du pire cas (le dimensionnement d’hier)', octets: octetsPireCas, source },
  ];
  const mesures = variantes.map(() => []);
  for (let ronde = 0; ronde < rondes; ronde++)
    for (let v = 0; v < variantes.length; v++) {
      if (!ronde) await lot(variantes[v].octets, Math.max(2, tours >> 2), variantes[v].source);
      mesures[v].push(await lot(variantes[v].octets, tours, variantes[v].source));
    }
  for (const buffer of livre.buffers) buffer.destroy();
  lecture.destroy();
  source.destroy();
  return {
    pages: packed.pageCount,
    noeuds: packed.nodeCount,
    coupes,
    octetsLivre: livre.readbackBytes,
    octetsPireCas,
    variantes: variantes.map((v, i) => {
      const lots = mesures[i].map((m) => m.ms);
      return {
        nom: v.nom,
        octets: v.octets,
        ms: Number(mediane(lots).toFixed(4)),
        // L'étendue des rondes : la bande dans laquelle cette carte rend la MÊME mesure. Un écart
        // qui n'en sort pas n'est pas un écart, et le banc refuse de l'affirmer.
        etendue: Number((Math.max(...lots) - Math.min(...lots)).toFixed(4)),
      };
    }),
  };
}
