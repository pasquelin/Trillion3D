import type { BackendFactory } from './backendTypes.ts';
import type { LightingExperimentRenderState } from './lightingObservationContracts.ts';
import { createObservationResources } from './lightingObservationResources.ts';
import { createObservationMeshes } from './lightingObservationMeshes.ts';
import { updateObservation } from './lightingObservationUpdate.ts';
import { createThreeSceneDraw } from './threeSceneAdapter.ts';
import {
  createObservationCapabilities,
  observationDiagnostic,
} from './lightingObservationDiagnostics.ts';
export type {
  LightingExperimentRenderState,
  LightingExperimentRayDiagnostics,
} from './lightingObservationContracts.ts';

/**
 * Observation backend for the transport experiment. Rasterizes prepared source
 * meshes; visibility for reflections is restricted to the declared rectangles
 * and sphere. It does not exercise cluster selection or general mesh tracing.
 */
export function createLightingExperimentBackend(
  state: LightingExperimentRenderState,
): BackendFactory {
  return ({ source, signal, onDiagnostic, webglContext }) => {
    const resources = createObservationResources(state);
    const meshes = createObservationMeshes(state, resources, source);
    const { triangles, geometryAllocationBytes, copies } = meshes;
    const { scene } = resources;
    const hostDraw = createThreeSceneDraw(webglContext, scene);
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
      render(camera) {
        hostDraw.render(camera);
        update();
      },
      drawHostGeometry: hostDraw.drawHostGeometry,
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
        hostDraw.dispose();
        meshes.dispose();
        resources.dispose();
        scene.clear();
      },
    };
  };
}
