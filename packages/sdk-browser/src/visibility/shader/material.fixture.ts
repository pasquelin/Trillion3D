import type { VisMaterial } from '../types.ts';

/** A lit, white, rough dielectric, front-sided and without maps, unless `overrides` say otherwise. */
export function litMaterial(overrides: Partial<VisMaterial> = {}): VisMaterial {
  return {
    baseColor: [1, 1, 1],
    metalness: 0,
    roughness: 1,
    lit: true,
    doubleSided: false,
    backSide: false,
    alphaTest: 0,
    normalScale: 1,
    normalScaleY: 1,
    aoIntensity: 1,
    emissive: [0, 0, 0],
    transmission: 0,
    ior: 1.5,
    thickness: 0,
    attenuationDistance: 0,
    attenuationColor: [1, 1, 1],
    ...overrides,
  };
}
