import type { EnvironmentSource } from '../../reflections/environmentShader.ts'

/** The probe coefficients seen along a view-space reflected ray, carried to their world. */
export const PROBE_ENVIRONMENT: EnvironmentSource = {
  prelude: 'var W:vec3f=R*viewRotation;',
  direction: 'W',
  coefficient: (k) => `probeSh[${k}]`,
}
