import type { BackendCapabilities, BackendDiagnostic } from '../types.ts';
import { TAA_CAPABILITY } from '../../taa/capability.ts';
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts';

/**
 * What the autonomous WebGL2 page path renders, and what it declares it does not: each feature
 * WebGL2 cannot carry is named, never silent (#483 rule 8), and published once as the WebGPU engine
 * publishes its own (`render-capabilities`). The page residency, its budget and the cut rule are
 * the engine's own, shared with WebGPU: what degrades is the work, never the coverage.
 */
export function autonomousCapabilities(
  simplification: boolean,
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void,
): BackendCapabilities {
  const capabilities = {
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
  sendEngineDiagnostic(onDiagnostic, 'render-capabilities', 'Render paths ready', {
    gpuSelection: false,
    unsupported: [...capabilities.unsupported],
  });
  return capabilities;
}
