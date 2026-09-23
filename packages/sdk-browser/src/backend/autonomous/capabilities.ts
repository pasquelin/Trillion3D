import type { BackendCapabilities } from '../types.ts';

/** What the autonomous WebGL2 page path renders, and what it declares it does not. */
export function autonomousCapabilities(simplification: boolean): BackendCapabilities {
  return {
    renderer: 'WebGL2 autonomous prepared pages',
    materials:
      'glTF opaque and alpha-mask materials; independent positions, normals, UVs and colors; tangents rebuilt per triangle',
    hierarchy: true,
    gpuDriven: false,
    simplification,
    eviction: true,
    unsupported: [
      'BLEND and transmission in a prepared autonomous scene',
      'GPU-driven selection and indirect drawing',
      'physical VRAM instrumentation',
      'global illumination',
    ],
  };
}
