import * as THREE from 'three';
import { setGeometryBounds } from './threeBounds.ts';
import { type BatchPage, DrawRanges, IndexRangeAllocator } from './clusterBatchRange.ts';
import { ClusterDrawMesh } from './clusterBatchMesh.ts';

type PageSlot = { offset: number; length: number };

/** Tampon d'index résident d'une primitive : géométrie unique partagée par toutes ses instances. */
export class PrimitiveIndex {
  geometry = new THREE.BufferGeometry();
  array: Uint32Array;
  attribute: THREE.BufferAttribute;
  allocator: IndexRangeAllocator;
  /** Une plage par URL distincte de la primitive ; `undefined` tant que la page n'est pas résidente. */
  slots: Array<PageSlot | undefined>;
  /** id de page -> rang d'URL distincte : accès O(1) sans table de hachage par image. */
  urlIndexByPage: Int32Array;
  /** Marquage d'image par URL distincte, pour dédupliquer la liste des pages sans Set. */
  stamps: Int32Array;
  /**
   * Plages écrites et pas encore envoyées au GPU. Une plage qui prolonge la précédente la rallonge sur
   * place, ce qui est le cas courant : l'allocateur sert les pages d'un même paquet à la suite. Le coût
   * d'un envoi ne dépend donc que des octets réellement arrivés, jamais de la taille du tampon.
   */
  private pendingStarts = new Int32Array(64);
  private pendingEnds = new Int32Array(64);
  private pendingCount = 0;
  constructor(
    attributes: THREE.BufferGeometry['attributes'],
    urlIndexByPage: Int32Array,
    lengths: Int32Array,
    min: ArrayLike<number>,
    max: ArrayLike<number>,
  ) {
    this.urlIndexByPage = urlIndexByPage;
    let capacity = 0;
    for (let i = 0; i < lengths.length; i++) capacity += lengths[i];
    this.array = new Uint32Array(capacity);
    this.attribute = new THREE.BufferAttribute(this.array, 1);
    this.allocator = new IndexRangeAllocator(capacity);
    this.slots = new Array(lengths.length);
    this.stamps = new Int32Array(lengths.length);
    this.geometry.attributes = { ...attributes };
    this.geometry.setIndex(this.attribute);
    setGeometryBounds(this.geometry, min, max);
  }
  /** Recrée le tampon plus grand : filet de sécurité si une page dépasse la taille annoncée par le manifeste. */
  private growTo(capacity: number) {
    const array = new Uint32Array(capacity);
    array.set(this.array);
    this.allocator.grow(capacity - this.array.length);
    this.array = array;
    this.attribute = new THREE.BufferAttribute(array, 1);
    this.geometry.setIndex(this.attribute);
  }
  reserve(urlIndex: number, array: Uint32Array) {
    const known = this.slots[urlIndex];
    if (known) return known;
    let offset = this.allocator.allocate(array.length);
    if (offset < 0) {
      this.growTo(this.array.length + array.length);
      offset = this.allocator.allocate(array.length);
    }
    this.array.set(array, offset);
    // L'envoi est différé au dessin de la primitive : une page arrivée pour une primitive hors champ
    // attend son tour sans rien coûter, et les plages accumulées partent ensemble.
    this.addPending(offset, array.length);
    const slot: PageSlot = { offset, length: array.length };
    this.slots[urlIndex] = slot;
    return slot;
  }
  private addPending(offset: number, length: number) {
    const count = this.pendingCount;
    if (count > 0 && this.pendingEnds[count - 1] === offset) {
      this.pendingEnds[count - 1] = offset + length;
      return;
    }
    if (count === this.pendingStarts.length) {
      const starts = new Int32Array(count * 2);
      starts.set(this.pendingStarts);
      this.pendingStarts = starts;
      const ends = new Int32Array(count * 2);
      ends.set(this.pendingEnds);
      this.pendingEnds = ends;
    }
    this.pendingStarts[count] = offset;
    this.pendingEnds[count] = offset + length;
    this.pendingCount = count + 1;
  }
  /** Appelé juste avant le rendu de la primitive : Three.js consommera l'envoi dans la foulée. Il trie
   *  et fusionne lui-même les plages voisines avant de les émettre. */
  flush() {
    if (!this.pendingCount) return;
    for (let i = 0; i < this.pendingCount; i++)
      this.attribute.addUpdateRange(
        this.pendingStarts[i],
        this.pendingEnds[i] - this.pendingStarts[i],
      );
    this.attribute.needsUpdate = true;
    this.pendingCount = 0;
  }
  free(urlIndex: number) {
    const slot = this.slots[urlIndex];
    if (!slot) return;
    this.slots[urlIndex] = undefined;
    this.allocator.release(slot.offset, slot.length);
  }
  dispose() {
    for (const name of Object.keys(this.geometry.attributes)) this.geometry.deleteAttribute(name);
    this.geometry.dispose();
  }
}

/** Un groupe = une instance de primitive, c'est-à-dire un `renderOrder`, exactement comme avant. */
export class BatchGroup {
  primitive: PrimitiveIndex;
  ranges = new DrawRanges();
  mesh: ClusterDrawMesh | undefined;
  sample: BatchPage | undefined;
  attached = false;
  touched = false;
  triangles = 0;
  transparent = false;
  /** Paire dos/face figée quand le matériau est transparent double face ; sinon indéfinie. */
  split: [THREE.Material, THREE.Material] | undefined;
  /** Matériau à biais de profondeur figé, sur les sous-lots d'une couche coplanaire supérieure à 0.
   *  Indéfini sur le lot de couche 0, qui dessine exactement comme avant. */
  biased: THREE.Material | undefined;
  /** Couche coplanaire de ce lot. 0 = le lot ordinaire. */
  layer = 0;
  pending: BatchPage[] = [];
  pendingCount = 0;
  constructor(primitive: PrimitiveIndex) {
    this.primitive = primitive;
  }
}
