import type * as THREE from 'three';
import type { ClusterDrawMesh } from './clusterBatchMesh.ts';

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

export function submitDiagnosticMesh(gl: WebGL2RenderingContext, mesh: THREE.Mesh) {
  const index = mesh.geometry.index;
  if (!index) {
    gl.drawArrays(gl.TRIANGLES, 0, mesh.geometry.attributes.position.count);
    return;
  }
  const type = index.array instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  gl.drawElements(gl.TRIANGLES, index.count, type, 0);
}
