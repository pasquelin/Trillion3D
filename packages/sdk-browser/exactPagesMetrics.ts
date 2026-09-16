import * as THREE from 'three';
import { geometryBytes } from './sceneMeshes.ts';
import { disposeTriangleGeometry } from './triangleDiagnostic.ts';
import type { PageRec } from './pageSelection.ts';
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
  readonly diagnostic: DiagnosticMode;
  readonly visible: number;
  readonly selectedTriangles: number;
  readonly frustumRejected: number;
  readonly lodLevel: number;
  readonly cpuSelectMs: number;
  readonly cpuSelectNodesTested: number;
  readonly frameHeld: boolean;
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
  } = ctx;
  return {
    metrics() {
      const batched = batches.metrics;
      // Mode beauté : les compteurs viennent des lots, sans parcourir les géométries. Mode diagnostic :
      // une géométrie par page, on retombe sur le comptage détaillé.
      let bytes = batched.allocationBytes,
        draws = blendCopies.length + batched.drawCalls,
        submitted = batched.submittedTriangles;
      if (ctx.diagnostic !== 'beauty') {
        metricsSeen.clear();
        bytes = 0;
        submitted = 0;
        draws = blendCopies.length;
        for (const rec of attached)
          if (rec.geometry) bytes += geometryBytes(rec.geometry, metricsSeen);
        for (let i = 0; i < attached.length; i++)
          if (attached[i].attached) {
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
        cpuSelectMs: ctx.cpuSelectMs,
        cpuSelectNodesTested: ctx.cpuSelectNodesTested,
        clusters: ctx.visible,
        selectedTriangles: ctx.selectedTriangles,
        residentPages: attached.length,
        pagesDetached: counters.pagesDetached,
        geometryAllocationBytes: bytes,
        frustumRejected: ctx.frustumRejected,
        lodLevel: ctx.lodLevel,
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
        frameHeld: ctx.frameHeld,
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
    },
  };
}
