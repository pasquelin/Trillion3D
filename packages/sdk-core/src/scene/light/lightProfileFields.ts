/** The fields of a scene light that give it a light profile (`SceneLight`): the shape of the light a
 *  lamp gives, measured in a photometric file, in place of the even sphere or cone of a lamp with none. */
export interface SceneLightProfile {
  /**
   * Point and spot only: the id of the light profile that shapes the light. The light's colour is
   * multiplied, for each direction it leaves in, by the profile's share of its greatest candela
   * there. A light that names one needs its `direction` and its `emitterAxis`, the frame the profile
   * is read in: the profile's vertical axis is the direction (its 0° vertical angle, the nadir, is
   * straight ahead along the way the light shines) and its horizontal angle runs round the axis,
   * which is the light's own up and, with an `emitterLength`, the axis of its tube as well. The axis
   * may not be parallel to the direction. An imported light's id is the name of the profile file the
   * compiler wrote; a host registers its own. At most `LIGHT_PROFILE_SLICES` profiles are held at
   * once; a light whose profile is not among them lights as a lamp with none.
   */
  iesProfile?: string
  /**
   * Beside an `iesProfile`: whether the light's intensity is the profile's brightness (its greatest
   * candela) times `iesBrightnessScale`, written in the light's unit, in place of `intensity`;
   * absent, off. The profile's brightness is the light's `iesBrightness`; a light that carries none
   * keeps its `intensity`.
   */
  useIesBrightness?: boolean
  /** Beside an `iesProfile` and `useIesBrightness`: the factor on the profile's brightness; at
   *  least 0, absent 1. */
  iesBrightnessScale?: number
  /**
   * Beside an `iesProfile`: the brightness of the profile, its greatest candela, a finite number
   * above 0. The compiler writes it with the profile it made (`lights.json`); absent, the light
   * has no brightness of its profile to take.
   */
  iesBrightness?: number
}
