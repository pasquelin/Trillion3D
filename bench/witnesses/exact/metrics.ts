import type {
  HostDiagnosticGeometry,
  HostGeometry,
} from '../../../packages/sdk-browser/src/host/resources.ts';
import type { HostGraphGeometry } from '../../../packages/sdk-browser/src/host/scene/graphResources.ts';
import { geometryBytes } from '../../../packages/sdk-browser/src/scene/meshes.ts';
import { disposeTriangleGeometry } from '../../../packages/sdk-browser/src/diagnostic/triangleDiagnostic.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import type { ExactPagesRenderState } from './render.ts';
import type { WebglFrameGate } from '../../../packages/sdk-browser/src/webgl/core/frameGate.ts';
import type { DiagnosticMode } from '../../../packages/sdk-core/src/index.ts';
import { ClusterBatches } from './batches/batches.ts';

/** A transparent copy the host renderer draws whole, as its triangles are counted. */
type CountedCopy = {
  readonly geometry: {
    getIndex(): { readonly count: number } | null;
    getAttribute(name: string): { readonly count: number };
  };
  readonly userData: Record<string, unknown>;
};

type MetricsContext = {
  batches: ClusterBatches;
  blendCopies: readonly CountedCopy[];
  metricsSeen: Set<ArrayBufferView>;
  attached: PageRec[];
  counters: { pagesDetached: number };
  materials: { disposeMaterials: () => void };
  allPages: PageRec[];
  disposeGeometry(geometry: HostGeometry): void;
  /** The display graph the pages hang on, emptied with the engine. */
  scene: { clear(): void };
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
          if (rec.geometry) bytes += geometryBytes(rec.geometry as HostGraphGeometry, metricsSeen);
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
        if (rec.geometry) disposeGeometry(rec.geometry);
        rec.geometry = undefined;
        rec.mesh = undefined;
      }
      for (const copy of blendCopies)
        disposeTriangleGeometry(copy.userData.sourceGeometry as HostDiagnosticGeometry);
      scene.clear();
      gate.release();
    },
  };
}
