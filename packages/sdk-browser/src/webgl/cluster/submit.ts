import { isInstancedNode } from '../../host/graph/kinds.ts'
import type { ClusterDrawMesh, WholeMesh } from '../../cluster/batchMesh.ts'

export type MultiDraw = {
  multiDrawElementsWEBGL(
    mode: number,
    counts: Int32Array,
    countsOffset: number,
    type: number,
    offsets: Int32Array,
    offsetsOffset: number,
    drawCount: number,
  ): void
}

export const submitClusterMesh = (
  gl: WebGL2RenderingContext,
  extension: MultiDraw | null,
  mesh: ClusterDrawMesh,
) => submitRanges(gl, extension, mesh._multiDrawStarts, mesh._multiDrawCounts, mesh._multiDrawCount)

/** `count` ranges of the bound 32-bit index buffer — `starts` in bytes, `counts` in indices — in
 *  one `WEBGL_multi_draw`, or one by one without it; a single range is one plain draw. */
export function submitRanges(
  gl: WebGL2RenderingContext,
  extension: MultiDraw | null,
  starts: Int32Array,
  counts: Int32Array,
  count: number,
) {
  if (extension && count > 1)
    extension.multiDrawElementsWEBGL(gl.TRIANGLES, counts, 0, gl.UNSIGNED_INT, starts, 0, count)
  else
    for (let i = 0; i < count; i++)
      gl.drawElements(gl.TRIANGLES, counts[i], gl.UNSIGNED_INT, starts[i])
}

/** A mesh drawn whole: its index, or its vertices in order, once — or once per placement of an
 *  instanced mesh, in one submission. */
export function submitDiagnosticMesh(
  gl: WebGL2RenderingContext,
  mesh: Pick<WholeMesh, 'geometry' | 'count'>,
) {
  const index = mesh.geometry.index,
    copies = isInstancedNode(mesh) ? mesh.count : 0
  if (!index) {
    const count = mesh.geometry.attributes.position.count
    if (copies) gl.drawArraysInstanced(gl.TRIANGLES, 0, count, copies)
    else gl.drawArrays(gl.TRIANGLES, 0, count)
    return
  }
  const array = index.array,
    type =
      array instanceof Uint32Array
        ? gl.UNSIGNED_INT
        : array instanceof Uint8Array
          ? gl.UNSIGNED_BYTE
          : gl.UNSIGNED_SHORT
  if (copies) gl.drawElementsInstanced(gl.TRIANGLES, index.count, type, 0, copies)
  else gl.drawElements(gl.TRIANGLES, index.count, type, 0)
}
