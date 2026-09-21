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
  /** How many of the copies the draw owner submits itself, culled like the host would. */
  ownedCopies: number;
  metricsSeen: Set<ArrayBufferView>;
  attached: PageRec[];
  counters: { pagesDetached: number };
  materials: { disposeMaterials: () => void };
  hostDraw: { dispose(): void };
  allPages: PageRec[];
  disposeGeometry: (geometry: THREE.BufferGeometry) => void;
  scene: THREE.Scene;
  readonly diagnostic: DiagnosticMode;
  /** What the current frame decided, read as-is: the sample does not copy field by field what
   *  the render state already carries. */
  state: ExactPagesRenderState;
};

export function createExactPagesMetrics(ctx: MetricsContext) {
  const {
    batches,
    blendCopies,
    ownedCopies,
    metricsSeen,
    attached,
    counters,
    materials,
    hostDraw,
    allPages,
    disposeGeometry,
    scene,
    state,
  } = ctx;
  return {
    metrics() {
      const batched = batches.metrics;
      // Beauty mode: counters come from the batches, without walking geometries. Diagnostic mode:
      // one geometry per page, we fall back on the detailed count.
      let bytes = batched.allocationBytes;
      if (ctx.diagnostic !== 'beauty') {
        metricsSeen.clear();
        bytes = 0;
        for (const rec of attached)
          if (rec.geometry) bytes += geometryBytes(rec.geometry, metricsSeen);
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
        submittedTriangles: batched.submittedTriangles,
        totalSubmittedTriangles: batched.submittedTriangles + transparentSubmittedTriangles,
        transparentMeshes: blendCopies.length,
        transparentSubmittedTriangles,
        transparentDrawCalls: blendCopies.length - ownedCopies + batched.copyDraws,
        drawCalls: blendCopies.length - ownedCopies + batched.copyDraws + batched.drawCalls,
        batchRebuilds: batched.pageRangeWrites,
        batchIndexBytesUpdated: batched.indexBytesWritten,
        pageRangeWrites: batched.pageRangeWrites,
        subDraws: batched.subDraws,
        autonomousClusterDrawsTotal: batched.autonomousClusterDrawsTotal,
        autonomousCopyDraws: batched.copyDraws,
        transmissionBackdropBytes: batched.backdropBytes,
        cpuSubmitMs: batched.cpuSubmitMs,
        frameHeld: state.frameHeld,
      };
    },
    dispose() {
      hostDraw.dispose();
      materials.disposeMaterials();
      batches.dispose();
      for (const rec of allPages) {
        if (rec.geometry) disposeGeometry(rec.geometry);
        rec.geometry = undefined;
        rec.mesh = undefined;
      }
      for (const copy of blendCopies)
        disposeTriangleGeometry(copy.userData.sourceGeometry as THREE.BufferGeometry);
      scene.clear();
    },
  };
}
