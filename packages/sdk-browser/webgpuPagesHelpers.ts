import * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { clusterHue } from './backendCommon.ts';

export const viewProj = new THREE.Matrix4();
export const remap = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const colorScratch = new THREE.Color();
export const PAGES_GREEN: [number, number, number] = [0.204, 0.827, 0.6];
/** Ceiling on the screen error the GPU page budget may impose; past it the root cover is the cut. */
export const MAX_BUDGET_PIXEL_ERROR = 4096;

const rgbHex = (red: number, green: number, blue: number) =>
  `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

/** First GPU readback evidence: requested clear versus two actual pixels from the color target. */
export function outputColorDiagnostic(
  pixels: Uint8Array,
  width: number,
  height: number,
  clearColor: number,
  origin: 'top-left' | 'bottom-left' = 'top-left',
) {
  const pixel = (x: number, y: number) => {
    const offset = ((origin === 'bottom-left' ? height - 1 - y : y) * width + x) * 4;
    return rgbHex(pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0);
  };
  const clearHex = `#${clearColor.toString(16).padStart(6, '0')}`;
  const topLeft = pixel(0, 0),
    center = pixel(Math.floor(width / 2), Math.floor(height / 2));
  return { clearColor: clearHex, topLeft, center, matchesClearAtTopLeft: topLeft === clearHex };
}

export function lighting(scene: THREE.Scene, clearColor: number) {
  scene.background = new THREE.Color(clearColor);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x495061, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(1, 3, 2);
  scene.add(light);
}
export function linearColor(material: THREE.Material | THREE.Material[]): [number, number, number] {
  const first = Array.isArray(material) ? material[0] : material;
  const color = (first as THREE.MeshBasicMaterial).color;
  if (!color) return [1, 1, 1];
  colorScratch.copy(color);
  if (THREE.ColorManagement.enabled) colorScratch.convertSRGBToLinear();
  return [colorScratch.r, colorScratch.g, colorScratch.b];
}
export function clusterRgb(id: string): [number, number, number] {
  colorScratch.setHSL(clusterHue(id), 0.75, 0.55);
  if (THREE.ColorManagement.enabled) colorScratch.convertSRGBToLinear();
  return [colorScratch.r, colorScratch.g, colorScratch.b];
}
export function materialSide(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material[0].side : material.side;
}

/**
 * Turns a GPU page-id list into records, into an array the caller owns: no per-frame allocation.
 * `into` absent : les comptes seuls sont relus, sur exactement les mêmes enregistrements et dans le
 * même ordre — ce que demande un appelant dont la liste est déjà faite de ce relevé.
 */
/**
 * The cut the GPU published, and what of it the frame cannot draw: a cluster whose page left the
 * cache between the selection's view of residency and now has no row, and no ancestor took its place
 * — that is a hole in the image, and `uncovered` is the only honest way to say so.
 */
const gpuCutCounts = { drawnTriangles: 0, uncoveredTriangles: 0, transparentTriangles: 0 };
export function shownFromGpu(
  pages: PageRec[],
  ids: readonly number[],
  into: PageRec[] | undefined,
  residentOffsetWords: Int32Array,
) {
  if (into) into.length = 0;
  let drawnTriangles = 0,
    uncovered = 0,
    transparent = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i],
      rec = pages[id];
    if (!rec) continue;
    if (into) into.push(rec);
    drawnTriangles += rec.triangles;
    if (rec.transparent) transparent += rec.triangles;
    if (residentOffsetWords[id] < 0 || !rec.array) uncovered += rec.triangles;
  }
  gpuCutCounts.drawnTriangles = drawnTriangles;
  gpuCutCounts.uncoveredTriangles = uncovered;
  gpuCutCounts.transparentTriangles = transparent;
  return gpuCutCounts;
}
/** Sum of a cut's triangles, without the closure a `reduce` allocates on every frame. */
export function triangleSum(pages: readonly PageRec[], transparent?: boolean) {
  let total = 0;
  for (let i = 0; i < pages.length; i++)
    if (transparent === undefined || !!pages[i].transparent === transparent)
      total += pages[i].triangles;
  return total;
}
/** Copies the records of `source` whose transparency matches, into an array the caller owns. */
export function partitionByPass(source: readonly PageRec[], transparent: boolean, into: PageRec[]) {
  into.length = 0;
  for (let i = 0; i < source.length; i++)
    if (!!source[i].transparent === transparent) into.push(source[i]);
  return into;
}
type DrawnMirror = { shown: PageRec[]; drawn: PageRec[]; drawnMirrorsShown: boolean };
type DrawnMirrorFlag = Pick<DrawnMirror, 'drawnMirrorsShown'>;
/**
 * Seul propriétaire du drapeau `drawnMirrorsShown` : vrai quand `drawn` est la recopie de `shown`
 * telle qu'elle est. Sur le chemin de la carte graphique, `drawn` n'est rien d'autre : l'adoption
 * la refait quand le relevé change, la reprise après capture de surface aussi, et la coupe
 * processeur marque la divergence dès son entrée parce qu'elle est la seule à écrire ces listes
 * autrement. Ces fonctions sont les seules à écrire le drapeau, valeur initiale comprise : rien
 * n'est encore recopié, la première image le fera.
 */
export const unmirroredDrawn = (): DrawnMirrorFlag => ({ drawnMirrorsShown: false });
/** `drawn` vient d'être refait depuis `shown` par l'appelant lui-même. */
export function markDrawnMirrored(run: DrawnMirrorFlag) {
  run.drawnMirrorsShown = true;
}
/** `drawn` va être écrit autrement que par recopie : la prochaine image devra le refaire. */
export function markDrawnDiverged(run: DrawnMirrorFlag) {
  run.drawnMirrorsShown = false;
}
/** Refait `drawn` depuis `shown`, que le drapeau soit levé ou non. */
export function copyDrawnFromShown(run: DrawnMirror) {
  run.drawn.length = 0;
  appendAll(run.drawn, run.shown);
  markDrawnMirrored(run);
}
/** Refait `drawn` depuis `shown` s'il n'en est plus la recopie ; rend vrai s'il l'a fait. */
export function mirrorDrawnFromShown(run: DrawnMirror) {
  if (run.drawnMirrorsShown) return false;
  copyDrawnFromShown(run);
  return true;
}
/** Spread arguments overflow the call stack beyond ~100k pages; append with a loop instead. */
export function appendAll<T>(target: T[], ...sources: readonly (readonly T[])[]) {
  for (const source of sources) for (let i = 0; i < source.length; i++) target.push(source[i]);
}
/** The request keys of a cut, for the trace sets. */
export const urlsOf = (pages: readonly PageRec[]) => pages.map((page) => page.url);
