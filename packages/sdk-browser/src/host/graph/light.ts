/**
 * The lights of the engine's own graph: directional, point and spot, at the reference's values
 * until a scene says otherwise, the node a directional or spot light aims at included.
 */
import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { GraphNode } from './node.ts';
import { GraphVector } from './vector.ts';

/** The kinds of light a scene declares. */
export type GraphLightKind = 'directional' | 'point' | 'spot';

/**
 * A light: its colour and intensity, the reach and cone of the kinds that have them, and the
 * node a directional or a spot light aims at — a child of its own, one unit down its `-z`, as a
 * scene declares it.
 */
export class GraphLight extends GraphNode {
  /** Always `true`: tells a light apart. */
  readonly isLight = true as const;
  /** Present on the kind of light it is. */
  declare readonly isDirectionalLight?: true;
  declare readonly isPointLight?: true;
  declare readonly isSpotLight?: true;
  /** Its colour, linear. */
  readonly color: Color;
  /** Its strength. */
  intensity = 1;
  /** Reach of a point or spot light; 0 is endless. */
  distance?: number;
  /** How a point or spot light fades with distance. */
  decay?: number;
  /** Half-angle of a spot light's cone. */
  angle?: number;
  /** How soft a spot light's edge is, 0 to 1. */
  penumbra?: number;
  /** What a directional or spot light aims at. */
  declare target?: GraphNode;
  /** The kind of light. */
  readonly kind: GraphLightKind;
  constructor(kind: GraphLightKind, colour = new Color().setRGB(1, 1, 1)) {
    super();
    this.kind = kind;
    this.color = colour;
    const brand = { directional: 'isDirectionalLight', point: 'isPointLight', spot: 'isSpotLight' };
    Object.assign(this, { [brand[kind]]: true });
    this.type = { directional: 'DirectionalLight', point: 'PointLight', spot: 'SpotLight' }[kind];
    if (kind !== 'directional') {
      this.distance = 0;
      this.decay = 2;
    }
    if (kind === 'spot') {
      this.angle = Math.PI / 3;
      this.penumbra = 0;
    }
    if (kind !== 'point') {
      // Stands one unit up until placed, and aims at the origin, as the reference's light does.
      this.position.set(0, 1, 0);
      this.updateMatrix();
      this.target = new GraphNode();
    }
  }
  protected override get looksDownNegativeZ() {
    return true;
  }
  protected override blank(): this {
    return new GraphLight(this.kind) as this;
  }
  override copy(source: GraphNode, recursive = true) {
    super.copy(source, recursive);
    const light = source as GraphLight;
    this.color.setRGB(light.color.r, light.color.g, light.color.b);
    this.intensity = light.intensity;
    this.distance = light.distance;
    this.decay = light.decay;
    this.angle = light.angle;
    this.penumbra = light.penumbra;
    // The copy aims at a copy of the target, outside the graph, as the reference's does.
    if (light.target) this.target = light.target.clone();
    return this;
  }
}

/** Light that reaches every surface alike, from no direction: an irradiance, added once. */
export class GraphAmbientLight extends GraphNode {
  /** Always `true`: tells a light apart. */
  readonly isLight = true as const;
  /** Always `true`: tells the ambient kind apart. */
  readonly isAmbientLight = true as const;
  override type = 'AmbientLight';
  /** Its colour, linear. */
  readonly color: Color;
  /** Its strength. */
  intensity: number;
  constructor(colour = new Color().setRGB(1, 1, 1), intensity = 1) {
    super();
    this.color = colour;
    this.intensity = intensity;
  }
  protected override blank(): this {
    return new GraphAmbientLight() as this;
  }
  override copy(source: GraphNode, recursive = true) {
    super.copy(source, recursive);
    const light = source as GraphAmbientLight;
    this.color.setRGB(light.color.r, light.color.g, light.color.b);
    this.intensity = light.intensity;
    return this;
  }
}

/**
 * A rectangle that glows on one face: its centre is the node's place, its face looks down the
 * node's `-z`, `width` runs along its `x` and `height` along its `y`. `distance` windows its
 * energy as the other kinds' range does; 0 is endless.
 */
export class GraphRectLight extends GraphNode {
  /** Always `true`: tells a light apart. */
  readonly isLight = true as const;
  /** Always `true`: tells the rectangle kind apart. */
  readonly isRectAreaLight = true as const;
  override type = 'RectAreaLight';
  /** Its colour, linear. */
  readonly color = new Color().setRGB(1, 1, 1);
  /** Its radiance. */
  intensity = 1;
  /** Size along its local `x`. */
  width = 10;
  /** Size along its local `y`. */
  height = 10;
  /** Reach; 0 is endless. */
  distance = 0;
  protected override get looksDownNegativeZ() {
    return true;
  }
  protected override blank(): this {
    return new GraphRectLight() as this;
  }
  override copy(source: GraphNode, recursive = true) {
    super.copy(source, recursive);
    const light = source as GraphRectLight;
    this.color.setRGB(light.color.r, light.color.g, light.color.b);
    this.intensity = light.intensity;
    this.width = light.width;
    this.height = light.height;
    this.distance = light.distance;
    return this;
  }
}

/** Nine spherical-harmonic coefficients of an environment's irradiance, band after band. */
class GraphIrradiance {
  /** One RGB triple per coefficient. */
  readonly coefficients = Array.from({ length: 9 }, () => new GraphVector());
  /** Reads the twenty-seven numbers, coefficient after coefficient. */
  fromArray(array: ArrayLike<number>, offset = 0) {
    this.coefficients.forEach((c, k) => c.fromArray(array, offset + k * 3));
    return this;
  }
}

/** The irradiance an environment sends, from every direction, as nine coefficients. */
export class GraphLightProbe extends GraphNode {
  /** Always `true`: tells a light apart. */
  readonly isLight = true as const;
  /** Always `true`: tells the probe apart; it takes no light slot. */
  readonly isLightProbe = true as const;
  override type = 'LightProbe';
  /** A tint, white: the coefficients carry the colour. */
  readonly color = new Color().setRGB(1, 1, 1);
  /** Scales every coefficient. */
  intensity = 1;
  /** The coefficients. */
  readonly sh = new GraphIrradiance();
  protected override blank(): this {
    return new GraphLightProbe() as this;
  }
  override copy(source: GraphNode, recursive = true) {
    super.copy(source, recursive);
    const probe = source as GraphLightProbe;
    this.color.setRGB(probe.color.r, probe.color.g, probe.color.b);
    this.intensity = probe.intensity;
    probe.sh.coefficients.forEach((c, k) => this.sh.coefficients[k].copy(c));
    return this;
  }
}
