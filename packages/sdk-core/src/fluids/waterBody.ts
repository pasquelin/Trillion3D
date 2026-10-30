/**
 * What the camera's test against the water reads of a body of water beyond its surface (`mesh.waterBody`, set on the mesh of a
 * surface whose material is single-layer water): whether the body has a material for the camera under its surface, how it ranks
 * among the bodies that overlap, and how deep it goes. A mesh with none is a body with every default.
 */
export interface WaterBodyOptions {
  /** Whether the body has a material laid over the image when the camera is under its surface; true by default, as every body
   *  the reference places gets its default underwater material. The camera test keeps only the bodies that have one, as the
   *  reference does for a body with none. */
  underwaterPostProcess?: boolean
  /** The rank of the body among those that overlap: the higher is weighed first among bodies that both have waves or both have
   *  none; 0 by default. */
  overlapPriority?: number
  /** Metres from the surface at rest down to the bottom of the body's volume. Unset, the bottom is the scene's geometry under the
   *  surface at the camera (the first thing a ray cast down from the surface meets, found by the engine's ray query a frame or so
   *  later), else the bottom of the mesh's own box; a mesh whose own box goes deeper takes that box's bottom. */
  depth?: number
}
