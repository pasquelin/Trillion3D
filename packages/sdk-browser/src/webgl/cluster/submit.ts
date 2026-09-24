import type { ClusterDrawMesh, WholeMesh } from '../../cluster/batchMesh.ts';

export type MultiDraw = {
  multiDrawElementsWEBGL(
    mode: number,
    counts: Int32Array,
    countsOffset: number,
    type: number,
    offsets: Int32Array,
    offsetsOffset: number,
    drawCount: number,
  ): void;
};

export function submitClusterMesh(
  gl: WebGL2RenderingContext,
  extension: MultiDraw | null,
  mesh: ClusterDrawMesh,
) {
  if (extension)
    extension.multiDrawElementsWEBGL(
      gl.TRIANGLES,
      mesh._multiDrawCounts,
      0,
      gl.UNSIGNED_INT,
      mesh._multiDrawStarts,
      0,
      mesh._multiDrawCount,
    );
  else
    for (let i = 0; i < mesh._multiDrawCount; i++)
      gl.drawElements(
        gl.TRIANGLES,
        mesh._multiDrawCounts[i],
        gl.UNSIGNED_INT,
        mesh._multiDrawStarts[i],
      );
}

/** A mesh drawn whole: its index, or its vertices in order, once — or once per placement of an
 *  instanced mesh, in one submission. */
export function submitDiagnosticMesh(
  gl: WebGL2RenderingContext,
  mesh: Pick<WholeMesh, 'geometry' | 'kind' | 'count'>,
) {
  const index = mesh.geometry.index,
    copies = mesh.kind === 'instancedMesh' ? mesh.count! : 0;
  if (!index) {
    const count = mesh.geometry.attributes.position.count;
    if (copies) gl.drawArraysInstanced(gl.TRIANGLES, 0, count, copies);
    else gl.drawArrays(gl.TRIANGLES, 0, count);
    return;
  }
  const array = index.array,
    type =
      array instanceof Uint32Array
        ? gl.UNSIGNED_INT
        : array instanceof Uint8Array
          ? gl.UNSIGNED_BYTE
          : gl.UNSIGNED_SHORT;
  if (copies) gl.drawElementsInstanced(gl.TRIANGLES, index.count, type, 0, copies);
  else gl.drawElements(gl.TRIANGLES, index.count, type, 0);
}
