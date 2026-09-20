import * as THREE from 'three';
import { geometryBytes } from './sceneMeshes.ts';
import { disposeTriangleGeometry } from './triangleDiagnostic.ts';
import type { PageRec } from './pageSelection.ts';
import type { ExactPagesRenderState } from './exactPagesRender.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { ClusterBatches } from './clusterBatches.ts';

type MetricsContext = {
  batches: ClusterBatches;
  blendCopies: THREE.Mesh[];
  metricsSeen: Set<ArrayBufferView>;
  attached: PageRec[];
  counters: { pagesDetached: number; displayDetachments: number };
  materials: { disposeMaterials: () => void };
  allPages: PageRec[];
  release: (rec: PageRec) => void;
  disposeGeometry: (geometry: THREE.BufferGeometry) => void;
  scene: THREE.Scene;
  /** The frame gate, released with the scene: the host graph keeps no hook of this engine. */
  gate: { release(): void };
  readonly diagnostic: DiagnosticMode;
  /** What the current frame decided, read as-is: the sample does not copy field by field what
   *  the render state already carries. */
  state: ExactPagesRenderState;
};

export function createExactPagesMetrics(ctx: MetricsContext) {
  const {
    batches,
    blendCopies,
    metricsSeen,
    attached,
    counters,
    materials,
    allPages,
    release,
    disposeGeometry,
    scene,
    gate,
    state,
  } = ctx;
  return {
    metrics() {
      const batched = batches.metrics;
      // Beauty mode: counters come from the batches, without walking geometries. Diagnostic mode:
      // one geometry per page, we fall back on the detailed count.
      let bytes = batched.allocationBytes,
        draws = blendCopies.length + batched.drawCalls,
        submitted = batched.submittedTriangles;
      if (ctx.diagnostic !== 'beauty') {
        metricsSeen.clear();
        bytes = 0;
        submitted = batches.autonomousDraw ? batched.submittedTriangles : 0;
        draws = blendCopies.length + (batches.autonomousDraw ? batched.drawCalls : 0);
        for (const rec of attached)
          if (rec.geometry) bytes += geometryBytes(rec.geometry, metricsSeen);
        for (let i = 0; i < attached.length; i++)
          if (!batches.autonomousDraw && attached[i].attached) {
            draws++;
            submitted += attached[i].triangles;
          }
      }
      const transparentSubmittedTriangles = blendCopies.reduce(
        (sum, copy) =>
          sum +
          (copy.geometry.getIndex()?.count ?? copy.geometry.getAttribute('position').count) / 3,
        0,
      );
      return {
        cpuSelectMs: state.cpuSelectMs,
        cpuSelectNodesTested: state.cpuSelectNodesTested,
        clusters: state.visible,
        selectedTriangles: state.selectedTriangles,
        residentPages: attached.length,
        pagesDetached: counters.pagesDetached,
        geometryAllocationBytes: bytes,
        frustumRejected: state.frustumRejected,
        lodLevel: state.lodLevel,
        submittedTriangles: submitted,
        totalSubmittedTriangles: submitted + transparentSubmittedTriangles,
        transparentMeshes: blendCopies.length,
        transparentSubmittedTriangles,
        transparentDrawCalls: blendCopies.length,
        drawCalls: draws,
        batchRebuilds: batched.pageRangeWrites,
        batchIndexBytesUpdated: batched.indexBytesWritten,
        displayDetachments: counters.displayDetachments + batched.detachments,
        pageRangeWrites: batched.pageRangeWrites,
        subDraws: batched.subDraws,
        autonomousClusterDrawsTotal: batched.autonomousClusterDrawsTotal,
        cpuSubmitMs: batched.cpuSubmitMs,
        frameHeld: state.frameHeld,
      };
    },
    dispose() {
      materials.disposeMaterials();
      batches.dispose();
      for (const rec of allPages) {
        if (rec.attached) release(rec);
        if (rec.geometry) disposeGeometry(rec.geometry);
        rec.geometry = undefined;
        rec.mesh = undefined;
      }
      for (const copy of blendCopies)
        disposeTriangleGeometry(copy.userData.sourceGeometry as THREE.BufferGeometry);
      scene.clear();
      gate.release();
    },
  };
}
