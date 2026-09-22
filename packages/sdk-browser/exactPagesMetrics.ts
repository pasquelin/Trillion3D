import * as THREE from 'three';
import { asHostLibrary } from './hostResources.ts';
import { geometryBytes } from './sceneMeshes.ts';
import { disposeTriangleGeometry } from './triangleDiagnostic.ts';
import type { PageRec } from './pageSelection.ts';
import type { ExactPagesRenderState } from './exactPagesRender.ts';
import type { WebglFrameGate } from './webglFrameGate.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { ClusterBatches } from './clusterBatches.ts';

type MetricsContext = {
  batches: ClusterBatches;
  blendCopies: THREE.Mesh[];
  metricsSeen: Set<ArrayBufferView>;
  attached: PageRec[];
  counters: { pagesDetached: number };
  materials: { disposeMaterials: () => void };
  allPages: PageRec[];
  disposeGeometry: (geometry: THREE.BufferGeometry) => void;
  scene: THREE.Scene;
  /** The frame gate, released with the scene: the host graph keeps no hook of this engine. */
  gate: WebglFrameGate;
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
      let bytes = batched.allocationBytes;
      if (ctx.diagnostic !== 'beauty') {
        metricsSeen.clear();
        bytes = 0;
        for (const rec of attached)
          if (rec.geometry)
            bytes += geometryBytes(asHostLibrary<THREE.BufferGeometry>(rec.geometry), metricsSeen);
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
        // Every copy is the owner's, submitted when in view, culled like the host would.
        transparentDrawCalls: batched.copyDraws,
        drawCalls: batched.copyDraws + batched.drawCalls,
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
      materials.disposeMaterials();
      batches.dispose();
      for (const rec of allPages) {
        if (rec.geometry) disposeGeometry(asHostLibrary<THREE.BufferGeometry>(rec.geometry));
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
