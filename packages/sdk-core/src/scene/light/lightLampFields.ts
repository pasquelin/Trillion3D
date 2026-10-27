/** The fields of a scene light that say what kind of lamp it is, beside its colour and its range
 *  (`SceneLight`): the size of its source, how its light falls off with the distance, and how much
 *  of its diffuse and specular light it gives. */
export interface SceneLightLamp {
  /**
   * Point and spot only: the radius, in metres, of the sphere the source is. It sets the source
   * size of the contact-hardening shadow filter, and the lamp lights a surface as a sphere of that
   * radius (`emitterLength` for a tube): the horizon wraps the light, a highlight spreads. A
   * housing that must not shadow its own light (lantern glass, reflector, shade) is a mesh that
   * does not cast shadows (`castShadow` false). It is a property of the light, never an object
   * name or a material type: the engine only knows surfaces. Strictly positive and strictly less
   * than the range; if absent, nothing changes.
   */
  emitterRadius?: number
  /** Point and spot only: the length, in metres, of the tube the source is (a capsule with its
   *  `emitterRadius`), centred on the light, along `emitterAxis`; absent, a sphere or a point.
   *  Strictly positive. */
  emitterLength?: number
  /** Point and spot only: the soft radius, in metres, that widens the highlight a source leaves
   *  without lighting more of the surface; strictly positive and strictly less than the range;
   *  absent, none. */
  emitterSoftRadius?: number
  /** Point and spot only, with an `emitterLength` or an `iesProfile`: the unit direction the tube lies along and the
   *  profile's horizontal angle runs round (a light's own up, `[0, 1, 0]` unless given, and required beside a
   *  profile); refused with neither. */
  emitterAxis?: [number, number, number]
  /** Point and spot only: whether the light falls off as the inverse square of the distance,
   *  windowed by its range; absent, it does. Off, it falls off by its range alone, as the
   *  `radialExponent` power of one less the squared distance over the squared range, with no
   *  distance law of its own. */
  inverseSquared?: boolean
  /** Point and spot only, where `inverseSquared` is off: the exponent of the fall-off, above 0;
   *  absent, 8. */
  radialExponent?: number
  /** The share of its diffuse light the light gives, from 0 to 1; absent, 1. */
  diffuseShare?: number
  /** The share of its specular light the light gives, from 0 to 1; absent, 1. */
  specularShare?: number
  /**
   * Point, spot and rect only: how much the light's strength is divided by the image's exposure, from 0 to 1. At 0 (absent) the light
   * keeps its strength whatever the exposure; at 1 it is divided by the exposure, so that it looks the same in a dark scene as in a
   * bright one; between, it is the geometric blend, the exposure to the power of minus this number. A directional light has none.
   */
  inverseExposureBlend?: number
  /**
   * Point, spot and rect only: the distance from the view, in metres, past which the light is left out of the image, its lighting and its
   * shadow both, in a perspective view (scaled by the view's `lightMaxDrawDistanceScale`); 0 (absent), no limit. A directional light
   * has none.
   */
  maxDrawDistance?: number
}
