import * as THREE from 'three';

/**
 * Lots de clusters à tampon d'index persistant.
 *
 * Une primitive source (jeu d'attributs partagé) possède un seul tampon d'index résident. Chaque page
 * y reçoit une plage fixe quand elle devient résidente : on n'écrit que cette plage, jamais tout le
 * tampon, et l'éviction la rend à l'allocateur. La coupe visible d'une image n'est alors qu'une liste
 * de sous-dessins (starts/counts) soumise en un appel par instance via `WEBGL_multi_draw` ; Three.js
 * retombe seul sur une boucle de drawElements quand l'extension manque.
 *
 * Le coût d'une image ne dépend donc plus du nombre total de pages ni du changement de coupe, mais
 * seulement du nombre de pages affichées.
 *
 * Limite assumée du prototype : la capacité d'une primitive est la somme des tailles de toutes ses
 * pages (exactes et grossières). Elle est donc résidente même quand la coupe n'en montre qu'une
 * partie ; borner cette capacité (et évincer des plages sous pression) reste à faire.
 *
 * Limite connue sur l'image : `isBatchedMesh` fait définir USE_BATCHING par Three.js, donc compiler une
 * variante de programme où les sommets passent par une multiplication supplémentaire. Cette matrice vaut
 * l'identité et le calcul est exact, mais le pilote n'arrondit pas tout à fait pareil : sur
 * emerald-square, 0,04 % à 0,39 % des pixels changent, sur des bords de silhouette. Annuler la définition
 * (`#undef USE_BATCHING` posé par `onBeforeCompile`) ramène l'écart maximal de 197 à 6 niveaux et rend
 * low-poly-city identique au bit près, mais coûte plus de la moitié des images présentées : à reprendre.
 */

import { type BatchPage } from './clusterBatchRange.ts';
import { PrimitiveIndex, BatchGroup } from './clusterBatchPrimitive.ts';
import { identityMatrixTexture, type ShaderHook } from './clusterBatchMesh.ts';
import { setupClusterBatches } from './clusterBatchSetup.ts';
import { updateClusterBatches } from './clusterBatchUpdate.ts';
export { IndexRangeAllocator, DrawRanges } from './clusterBatchRange.ts';
export type { BatchPage } from './clusterBatchRange.ts';

export type ClusterBatchStats = {
  drawCalls: number;
  subDraws: number;
  submittedTriangles: number;
  allocationBytes: number;
  pageRangeWrites: number;
  indexBytesWritten: number;
  detachments: number;
};

/** Ensemble des lots d'une scène : un tampon d'index par primitive, un objet de dessin par instance. */
export class ClusterBatches {
  private scene: THREE.Scene;
  private primitives: PrimitiveIndex[] = [];
  private groups: Array<BatchGroup | undefined> = [];
  private active: BatchGroup[] = [];
  private touched: BatchGroup[] = [];
  private matrices = identityMatrixTexture();
  private indirect: THREE.DataTexture;
  private shaderHooks = new Map<THREE.Material, ShaderHook>();
  /** Clones dos/face créés ici : à libérer, contrairement aux matériaux de la scène. */
  private splitMaterials: THREE.Material[] = [];
  private attributeBytes = 0;
  private indexCapacityBytes = 0;
  private stats: ClusterBatchStats = {
    drawCalls: 0,
    subDraws: 0,
    submittedTriangles: 0,
    allocationBytes: 0,
    pageRangeWrites: 0,
    indexBytesWritten: 0,
    detachments: 0,
  };

  constructor(scene: THREE.Scene, pages: readonly BatchPage[]) {
    this.scene = scene;
    const setup = setupClusterBatches(pages);
    this.primitives = setup.primitives;
    this.groups = setup.groups;
    this.indirect = setup.indirect;
    this.shaderHooks = setup.shaderHooks;
    this.splitMaterials = setup.splitMaterials;
    this.attributeBytes = setup.attributeBytes;
    this.indexCapacityBytes = setup.indexCapacityBytes;
    for (const page of pages) if (page.array) this.acceptPage([page], page.array);
    this.stats.allocationBytes = this.indexCapacityBytes + this.attributeBytes;
  }

  get metrics(): Readonly<ClusterBatchStats> {
    return this.stats;
  }
  /** Capacité résidente des tampons d'index, en octets. Relue après une croissance éventuelle. */
  get indexBytes() {
    let bytes = 0;
    for (let i = 0; i < this.primitives.length; i++) bytes += this.primitives[i].array.byteLength;
    return bytes;
  }

  /** Écrit la plage d'une page devenue résidente. Aucune autre partie du tampon n'est touchée.
   *  Une requête peut porter un paquet de streaming : chaque enregistrement a alors déjà reçu sa
   *  propre vue à son offset dans ce paquet, et c'est cette vue — pas le paquet — qui est écrite. */
  acceptPage(recs: readonly BatchPage[], array: Uint32Array) {
    for (const rec of recs) {
      const group = this.groups[rec.renderOrder];
      if (!group) continue;
      const urlIndex = group.primitive.urlIndexByPage[rec.id];
      if (urlIndex < 0 || group.primitive.slots[urlIndex]) continue;
      const slice = rec.array ?? array;
      const capacity = group.primitive.array.byteLength;
      group.primitive.reserve(urlIndex, slice);
      this.indexCapacityBytes += group.primitive.array.byteLength - capacity;
      this.stats.pageRangeWrites++;
      this.stats.indexBytesWritten += slice.byteLength;
    }
  }

  /** Rend la plage d'une page évincée à l'allocateur de sa primitive. */
  dropPage(recs: readonly BatchPage[]) {
    for (const rec of recs) {
      const group = this.groups[rec.renderOrder];
      if (!group) continue;
      const urlIndex = group.primitive.urlIndexByPage[rec.id];
      if (urlIndex < 0) continue;
      group.primitive.free(urlIndex);
    }
  }

  /** Liste les URL d'une coupe sans Set : une estampille par page distincte de chaque primitive. */
  markUrls(pages: readonly BatchPage[], stamp: number, into: string[]) {
    for (let i = 0; i < pages.length; i++) {
      const rec = pages[i];
      const group = this.groups[rec.renderOrder];
      const urlIndex = group ? group.primitive.urlIndexByPage[rec.id] : -1;
      if (!group || urlIndex < 0) {
        into.push(rec.url);
        continue;
      }
      const stamps = group.primitive.stamps;
      if (stamps[urlIndex] === stamp) continue;
      stamps[urlIndex] = stamp;
      into.push(rec.url);
    }
    return into;
  }

  /** Construit la coupe de l'image à partir des plages résidentes. */
  update(display: readonly BatchPage[]) {
    const state = {
      scene: this.scene,
      groups: this.groups,
      active: this.active,
      touched: this.touched,
      matrices: this.matrices,
      indirect: this.indirect,
      stats: this.stats,
      indexCapacityBytes: this.indexCapacityBytes,
      attributeBytes: this.attributeBytes,
    };
    updateClusterBatches(state, display);
    this.active = state.active;
    this.touched = state.touched;
  }

  /** Modes diagnostic : les lots disparaissent, les pages sont dessinées une à une par l'appelant. */
  hideAll() {
    const active = this.active;
    for (let i = 0; i < active.length; i++) {
      const group = active[i];
      if (!group.attached || !group.mesh) continue;
      this.scene.remove(group.mesh);
      group.attached = false;
      this.stats.detachments++;
    }
    active.length = 0;
    this.stats.drawCalls = 0;
    this.stats.subDraws = 0;
    this.stats.submittedTriangles = 0;
  }

  dispose() {
    this.hideAll();
    for (const [material, previous] of this.shaderHooks) {
      material.onBeforeCompile = previous as THREE.Material['onBeforeCompile'];
      delete (material as { customProgramCacheKey?: unknown }).customProgramCacheKey;
      material.needsUpdate = true;
    }
    this.shaderHooks.clear();
    for (const material of this.splitMaterials) material.dispose();
    this.splitMaterials.length = 0;
    for (const group of this.groups)
      if (group) {
        group.mesh = undefined;
        group.split = undefined;
      }
    for (const primitive of this.primitives) primitive.dispose();
    this.primitives.length = 0;
    this.groups.length = 0;
    this.matrices.dispose();
    this.indirect.dispose();
  }
}
