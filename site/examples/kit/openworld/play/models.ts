import { euler } from './math3.ts';
import type { Engine, ModelPart, ModelSpec, Node3, SpotNode, Surface, Vec3 } from './types.ts';

/**
 * Builds a model from its JSON-able spec with the page's engine families: one group, one mesh per
 * part, one wheel per wheel anchor (a cylinder whose axis is the group's +Y until the physics
 * turns it onto the axle), a propeller, and a spot light per headlight anchor. Geometries and
 * materials are shared between every model built by one builder.
 */
export type Built = {
  root: Node3;
  wheels: Node3[];
  propeller: Node3 | null;
  lamps: SpotNode[];
};

export type Builder = (spec: ModelSpec, options?: { lamps?: boolean }) => Built;

export function builder(engine: Engine): Builder {
  const shapes = new Map<string, unknown>();
  const matters = new Map<string, unknown>();
  const shape = (kind: ModelPart['shape'], size: Vec3) => {
    const key = `${kind}:${size.join(',')}`;
    if (!shapes.has(key)) {
      const { geometry } = engine;
      const [w, h, d] = size;
      shapes.set(
        key,
        kind === 'box'
          ? geometry.box(w, h, d)
          : kind === 'cylinder'
            ? geometry.cylinder(w / 2, w / 2, h, 16)
            : kind === 'cone'
              ? geometry.cone(w / 2, h, 16)
              : geometry.sphere(w / 2, 16, 12),
      );
    }
    return shapes.get(key);
  };
  const matter = (surface: Surface) => {
    const key = JSON.stringify(surface);
    if (!matters.has(key)) {
      const [r, g, b, a] = surface.color;
      matters.set(
        key,
        engine.material.meshStandard({
          color: [r, g, b],
          metalness: surface.metalness,
          roughness: surface.roughness,
          ...(surface.emissive && {
            emissive: surface.emissive,
            emissiveIntensity: surface.emissiveStrength ?? 1,
          }),
          ...(surface.alpha === 'blend' && { transparent: true, opacity: a }),
        }),
      );
    }
    return matters.get(key);
  };
  const place = (node: Node3, position: Vec3, rotation?: Vec3) => {
    node.position.set(...position);
    if (rotation) node.quaternion.set(...euler(...rotation));
    return node;
  };
  const tyre: Surface = {
    name: 'tyre',
    color: [0.03, 0.03, 0.03, 1],
    metalness: 0,
    roughness: 0.9,
  };
  const hub: Surface = { name: 'hub', color: [0.6, 0.6, 0.62, 1], metalness: 0.9, roughness: 0.3 };
  return (spec, options = {}) => {
    const root = engine.object.group();
    for (const part of spec.parts)
      root.add(
        place(
          engine.object.mesh(shape(part.shape, part.size), matter(part.surface)),
          part.position,
          part.rotation,
        ),
      );
    const wheels = (spec.anchors?.wheels ?? []).map((wheel) => {
      const node = engine.object.group();
      const size = wheel.radius * 2;
      node.add(engine.object.mesh(shape('cylinder', [size, wheel.width, size]), matter(tyre)));
      // A hub cap off centre, so a turning wheel is seen to turn.
      node.add(
        place(
          engine.object.mesh(shape('box', [size * 0.7, wheel.width * 1.05, 0.08]), matter(hub)),
          [0, 0, 0],
        ),
      );
      root.add(place(node, wheel.position));
      return node;
    });
    const anchor = spec.anchors?.propeller;
    let propeller: Node3 | null = null;
    if (anchor) {
      propeller = engine.object.group();
      propeller.add(engine.object.mesh(shape('box', [anchor.radius * 2, 0.2, 0.06]), matter(hub)));
      root.add(place(propeller, anchor.position));
    }
    const lamps = options.lamps
      ? (spec.anchors?.headlights ?? []).map((at) => {
          const lamp = engine.light.spot({
            color: [1, 0.93, 0.8],
            intensity: 0,
            distance: 80,
            angle: 0.45,
            penumbra: 0.5,
            position: at,
          });
          lamp.target.position.set(at[0], at[1] - 2, at[2] - 30);
          root.add(lamp, lamp.target);
          return lamp;
        })
      : [];
    return { root, wheels, propeller, lamps };
  };
}
