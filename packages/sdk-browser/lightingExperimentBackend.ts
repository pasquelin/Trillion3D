import type { BackendFactory } from './backendTypes.ts';
import type { LightingExperimentRenderState } from './lightingObservationContracts.ts';
import { createObservationResources } from './lightingObservationResources.ts';
import { createObservationMeshes } from './lightingObservationMeshes.ts';
import { updateObservation } from './lightingObservationUpdate.ts';
import { createObservationDraw } from './lightingObservationDraw.ts';
import {
  createObservationCapabilities,
  observationDiagnostic,
} from './lightingObservationDiagnostics.ts';

/**
 * Observation backend for the transport experiment. Rasterizes the prepared source meshes on
 * the engine's own program; visibility for reflections is restricted to the declared
 * rectangles and sphere. It does not exercise cluster selection or general mesh tracing.
 */
export function createLightingExperimentBackend(
  state: LightingExperimentRenderState,
): BackendFactory {
  return ({ source, signal, onDiagnostic, webglContext }) => {
    const resources = createObservationResources(state);
    const meshes = createObservationMeshes(state, resources, source);
    const { triangles, geometryAllocationBytes, copies } = meshes;
    const { scene } = resources;
    const draw = createObservationDraw(webglContext, resources, meshes);
    let disposed = false;
    const update = () => {
      if (disposed) throw new Error('Lighting experiment backend is disposed');
      signal?.throwIfAborted();
      updateObservation(state, resources, meshes);
    };
    return {
      id: 'lighting-experiment-webgl2',
      scene,
      overBudget: false,
      capabilities: createObservationCapabilities(),
      async prepare() {
        update();
        onDiagnostic?.(observationDiagnostic(resources, meshes));
      },
      render() {
        update();
      },
      drawHostGeometry: draw.drawHostGeometry,
      metrics: () => ({
        clusters: null,
        selectedTriangles: triangles,
        submittedTriangles: triangles,
        totalSubmittedTriangles: triangles,
        residentPages: null,
        geometryAllocationBytes,
        pagesDetached: 0,
        frustumRejected: 0,
        lodLevel: null,
        drawCalls: copies.length,
        coverageReady: true,
        coverageBudgetLimited: false,
        transparentMeshes: 0,
        transparentDrawCalls: 0,
        transparentSubmittedTriangles: 0,
      }),
      dispose() {
        if (disposed) return;
        disposed = true;
        draw.dispose();
      },
    };
  };
}
