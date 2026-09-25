// Packing of a DAG selection case into page-crossable bytes, and the result shapes the WGSL
// kernel (`selectionKernelGpu.ts`) reads and returns. Split apart so the kernel file holds
// `check:lines`.
import { writeDagUniforms } from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts';
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts';
import type { SelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { primitiveFrameWords } from '../../../packages/sdk-browser/src/gpu/dag/worlds.ts';
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/types.ts';
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts';

const octets = (vue: ArrayBufferView): number[] =>
  Array.from(new Uint8Array(vue.buffer, vue.byteOffset, vue.byteLength));

/** A packed case, ready to cross into the page: raw bytes, including cluster integers. */
export function versPage(name: string, packed: PackedDag, uniforms: SelectionUniforms) {
  // The whole uniform array the kernel binds; the case fills its first view.
  const uni = new Float32Array(DAG_UNIFORM_BYTES / 4);
  writeDagUniforms(uni, packed, uniforms, false);
  const frames = primitiveFrameWords(packed);
  const blockCount = Math.ceil(Math.max(1, packed.pageCount) / SELECTION_WORKGROUP);
  return {
    name,
    travail: dagWorkLayout(blockCount),
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

type PageCase = ReturnType<typeof versPage>;
export interface ExecuterEntree {
  shader: string;
  cas: PageCase[];
  workgroup: number;
  entete: number;
  totaux: { selected: number; transparent: number; drawn: number; uncovered: number };
  bitsPage: number;
  /** Group-0 layout, read from `dagBindEntries`: the page has no module to import it from. */
  layoutEntries: GPUBindGroupLayoutEntry[];
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
