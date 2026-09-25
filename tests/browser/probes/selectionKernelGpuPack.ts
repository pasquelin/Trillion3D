// Packing of a DAG selection case into page-crossable bytes, and the result shapes the WGSL
// kernel (`selectionKernelGpu.ts`) reads and returns. Split apart so the kernel file holds
// `check:lines`.
import { writeDagUniforms } from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts';
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts';
import type { SelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { primitiveFrameWords } from '../../../packages/sdk-browser/src/gpu/dag/worlds.ts';
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/types.ts';
import type { DAG_BINDING } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts';
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts';
import { createDagReadiness } from '../../../packages/sdk-browser/src/gpu/dag/readiness.ts';
import { childBase, residentBase } from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';

const octets = (vue: ArrayBufferView): number[] =>
  Array.from(new Uint8Array(vue.buffer, vue.byteOffset, vue.byteLength));

/** The cut rule's residency bits over a copy of the cold words, and the node open counts written
 *  into `packed`, as the engine's host uploads them (`gpu/dag/residencyUpload.ts`). */
function withResidency(packed: PackedDag, resident: ArrayLike<number>) {
  const readiness = createDagReadiness(packed);
  readiness.apply(resident);
  const { buffer, byteOffset, length } = packed.pageCones;
  const cold = new Uint32Array(buffer, byteOffset, length).slice();
  const sets = [
    [readiness.isReady, residentBase(packed.pageCount)],
    [readiness.isChildReady, childBase(packed.pageCount)],
  ] as const;
  for (const [ready, base] of sets)
    for (let page = 0; page < packed.pageCount; page++)
      if (ready(page)) cold[base + (page >>> 5)] |= 1 << (page & 31);
  return cold;
}

/** A packed case, ready to cross into the page: raw bytes, including cluster integers. With
 *  `resident`, the kernel applies the cut rule on that per-page residency (pages missing). */
export function versPage(
  name: string,
  packed: PackedDag,
  uniforms: SelectionUniforms,
  resident?: ArrayLike<number>,
) {
  // Before the node bytes are read: readiness writes each node's open count into them.
  const cold = resident ? withResidency(packed, resident) : packed.pageCones;
  // The whole uniform array the kernel binds; the case fills its first view.
  const uni = new Float32Array(DAG_UNIFORM_BYTES / 4);
  writeDagUniforms(uni, packed, uniforms, !!resident);
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
    pageCones: octets(cold),
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
  totaux: { selected: number; transparent: number };
  bitsPage: number;
  /** Group-0 layout, read from `dagBindEntries`: the page has no module to import it from. */
  layoutEntries: GPUBindGroupLayoutEntry[];
  /** Group-0 binding of each buffer by WGSL name (`DAG_BINDING`), for `namedBufferEntries`. */
  bindings: typeof DAG_BINDING;
}
export interface Resultat {
  name: string;
  demandes: number[];
  pages: number[];
  frustumRejected: number;
  overflow: number;
  selectedTriangles: number;
  transparentTriangles: number;
  /** Pages `dagMask` flagged drawn, in increasing order. */
  dessinees: number[];
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
