// Packing of a DAG selection case into page-crossable bytes, and the result shapes the WGSL
// kernel (`noyauSelectionGpu.ts`) reads and returns. Split apart so the kernel file holds
// `check:lines`.
import { writeDagUniforms } from '../../../packages/sdk-browser/gpuDagUniforms.ts';
import {
  SELECTION_UNIFORM_BYTES,
  SELECTION_WORKGROUP,
} from '../../../packages/sdk-browser/gpuSelection.ts';
import type { SelectionUniforms } from '../../../packages/sdk-browser/gpuSelection.ts';
import { FRAME_VEC4 } from '../../../packages/sdk-browser/gpuDagTypes.ts';
import type { PackedDag } from '../../../packages/sdk-browser/gpuDagTypes.ts';
import { dagWorkLayout } from '../../../packages/sdk-browser/gpuDagFloorWgsl.ts';

const octets = (vue: ArrayBufferView): number[] =>
  Array.from(new Uint8Array(vue.buffer, vue.byteOffset, vue.byteLength));

/** A packed case, ready to cross into the page: raw bytes, including cluster integers. */
export function versPage(name: string, packed: PackedDag, uniforms: SelectionUniforms) {
  const uni = new Float32Array(SELECTION_UNIFORM_BYTES / 4);
  writeDagUniforms(uni, packed, uniforms, false);
  const frames = new Float32Array(Math.max(1, packed.worldCount) * FRAME_VEC4 * 4);
  const frameInts = new Uint32Array(frames.buffer);
  for (let w = 0; w < packed.worldCount; w++) {
    frames[(w * FRAME_VEC4 + 6) * 4] = packed.worldStretch[w];
    // The primitive's root travels with its stretch: level descent starts from it.
    frameInts[(w * FRAME_VEC4 + 6) * 4 + 1] = packed.rootNodes[w];
  }
  const blockCount = Math.ceil(Math.max(1, packed.pageCount) / SELECTION_WORKGROUP);
  return {
    name,
    travail: dagWorkLayout(blockCount, Math.max(1, packed.worldCount)),
    pageCount: packed.pageCount,
    nodeCount: packed.nodeCount,
    worldCount: Math.max(1, packed.worldCount),
    levelCount: packed.levelSizes.length,
    clusters: octets(packed.clusters),
    nodes: octets(packed.nodes),
    worlds: octets(packed.worlds),
    pageCones: octets(packed.pageCones),
    frames: octets(frames),
    uniforms: octets(uni),
  };
}

export type PageCase = ReturnType<typeof versPage>;
export interface ExecuterEntree {
  shader: string;
  cas: PageCase[];
  workgroup: number;
  entete: number;
  totaux: { selected: number; transparent: number; drawn: number; uncovered: number };
  bitsPage: number;
}
export interface Resultat {
  name: string;
  demandes: number[];
  pages: number[];
  frustumRejected: number;
  overflow: number;
  selectedTriangles: number;
  transparentTriangles: number;
  drawnTriangles: number;
  uncoveredTriangles: number;
  candidates: number;
  vivantes: number;
}
export interface ExecutionResultat {
  indisponible?: string;
  compilation?: string[];
  adaptateur?: string;
  resultats?: Resultat[];
  erreurs?: string[];
}
