import type { JsonSchemaProperty } from './types.ts'

/** The `hairGroups` option (`hairGroupsOptions.ts`, `resolveHairGroups`). */
export const hairGroups: JsonSchemaProperty = {
  type: 'object',
  description:
    'Settings for the groups of a hair groom, an object whose keys are group numbers (the whole numbers the curves of a scene are cut into groups by) and whose values are objects of two booleans: stableRasterization (the group does not alias, and may look thicker) and scatterSceneLighting (short hair takes the light of the surface under it, as skin does). A setting left out follows the project setting (hairStableRasterization, hairScatterSceneLighting), as does a group not named.',
}
