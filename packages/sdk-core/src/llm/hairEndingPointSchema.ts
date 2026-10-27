import type { JsonSchemaProperty } from './types.ts'

/** The `hairEndingPoint` option (`hairEndingPointOptions.ts`, `resolveHairEndingPoint`). */
export const hairEndingPoint: JsonSchemaProperty = {
  type: 'boolean',
  default: true,
  description:
    'Whether each curve of a hair groom (an Alembic curves object, a USD BasisCurves) is given one control point more at its end, a tenth of its last segment past its last point, so that the strip of triangles drawn from the points keeps the last segment of the curve; false gives none (default true).',
}
