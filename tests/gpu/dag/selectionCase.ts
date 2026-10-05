// A DAG selection case laid out the way the engine's host uploads it: the buffers' contents and
// sizes the selection kernel binds (`selectionKernel.ts`), each derived from the engine's own
// layout functions, never restated.
import { writeDagUniforms } from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts';
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import type { SelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts';
import { primitiveFrameWords } from '../../../packages/sdk-browser/src/gpu/dag/worlds.ts';
import { framesBytes } from '../../../packages/sdk-browser/src/gpu/dag/frameRanges.ts';
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/types.ts';
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts';
import { dagFlagsWords } from '../../../packages/sdk-browser/src/gpu/dag/shader/lastUseWgsl.ts';
import { createDagReadiness } from '../../../packages/sdk-browser/src/gpu/dag/readiness.ts';
import { worldBufferWords } from '../../../packages/sdk-browser/src/gpu/dag/worldBuffer.fixture.ts';
import {
  childBase,
  residentBase,
  selectionListCap,
  stagedOutputBytes,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';

/** One cut to run: a packed scene, the camera's uniforms and, for a cut rule on missing pages,
 *  each page's residency. */
export interface SelectionCase {
  name: string;
  packed: PackedDag;
  uniforms: SelectionUniforms;
  resident?: ArrayLike<number>;
}

/** The cut rule's two residency bit sets over a copy of the cold words, and each node's open
 *  count written into `packed`, as the engine's host uploads them (`gpu/dag/residencyUpload.ts`). */
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

/** What the kernel binds for `selectionCase`, each buffer under its WGSL name, with the sizes the
 *  engine gives the ones it writes. */
export function caseBuffers({ packed, uniforms, resident }: SelectionCase) {
  // Before the node words are read: readiness writes each node's open count into them.
  const cold = resident ? withResidency(packed, resident) : packed.pageCones;
  const listCap = selectionListCap(packed.pageCount);
  const views = new Float32Array(DAG_UNIFORM_BYTES / 4);
  writeDagUniforms(views, packed, uniforms, !!resident, listCap);
  const blockCount = Math.ceil(Math.max(1, packed.pageCount) / SELECTION_WORKGROUP),
    worldCount = Math.max(1, packed.worldCount);
  return {
    work: dagWorkLayout(blockCount),
    flagsWords: dagFlagsWords(packed.nodeCount, packed.pageCount),
    /** `out` with the staged requests behind the readout. */
    outBytes: stagedOutputBytes(listCap),
    worldCount,
    clusters: packed.clusters,
    nodes: packed.nodes,
    worlds: worldBufferWords(packed.worlds, packed.worldSources),
    cold,
    /** The host's row per primitive, then what `dagPrepare` derives behind it. */
    frames: primitiveFrameWords(packed),
    framesBytes: framesBytes(worldCount),
    /** One range holds every primitive (`frameRanges.ts`): `{first, count}`. */
    range: new Uint32Array([0, worldCount, 0, 0]),
    views,
  };
}
