import type { BackendCapabilities, BackendDiagnostic } from '../types.ts';
import { TAA_CAPABILITY } from '../../taa/capability.ts';
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts';

/** What the autonomous WebGL2 page path renders, and what it cannot carry, named, never silent
 *  (#483 rule 8): published by `publishAutonomousCapabilities`. */
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
