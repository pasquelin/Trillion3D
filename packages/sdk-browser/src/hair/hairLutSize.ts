/** The slices along the absorption: the square number at or below the setting, 1 at least. */
export const hairLutAbsorptions = (requested: number) =>
  Math.max(1, Math.floor(Math.sqrt(requested)) ** 2)
