import type { BackendCapabilities } from '../types.ts';
import { TAA_CAPABILITY } from '../../taa/capability.ts';

/** What the autonomous WebGL2 page path renders, and what it declares it does not. */
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
      'physical VRAM instrumentation',
      'global illumination',
      TAA_CAPABILITY,
    ],
  };
}
