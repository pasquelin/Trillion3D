import type { BackendCapabilities, BackendDiagnostic } from '../types.ts';
import { TAA_CAPABILITY } from '../../taa/capability.ts';
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts';

/**
 * What the autonomous WebGL2 page path renders, and what it declares it does not: each feature
 * WebGL2 cannot carry is named, never silent (#483 rule 8), and published once prepared, as the
 * WebGPU engine publishes its own (`render-capabilities`, `publishAutonomousCapabilities`). The
 * page residency, its budget and the cut rule are the engine's own, shared with WebGPU: what
 * degrades is the work, never the coverage.
 */
export function autonomousCapabilities(simplification: boolean): BackendCapabilities {
  return {
    renderer: 'WebGL2 autonomous prepared pages',
    materials:
      'glTF opaque, alpha-mask and blended materials, and the transmission volume, drawn whole ' +
      'over a frozen backdrop; independent positions, normals, UVs and colors; tangents rebuilt ' +
      'per triangle',
    hierarchy: true,
    gpuDriven: false,
    simplification,
    eviction: true,
    unsupported: [
      'GPU-driven selection and indirect drawing',
      'occlusion culling',
      'cast shadows',
      'physical VRAM instrumentation',
      'global illumination',
      TAA_CAPABILITY,
    ],
  };
}

/** Publishes the declared capabilities once the path is prepared, as WebGPU does at the end of its
 *  own preparation: a path that failed to prepare announces nothing ready. */
export function publishAutonomousCapabilities(
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void,
) {
  sendEngineDiagnostic(onDiagnostic, 'render-capabilities', 'Render paths ready', {
    gpuSelection: false,
    unsupported: autonomousCapabilities(false).unsupported,
  });
}
