import type { Engine, Families, Look, Mesh, Shape, Vec3 } from './engineTypes.ts';

type Paint = Omit<Parameters<(typeof Engine)['material']['meshStandard']>[0] & object, 'color'>;
/** The primitives a body's drawn part collides as. */
type Solid = Exclude<Engine.PhysicsPrimitive, { type: 'capsule' }>;
/** A body whose box carries the mass, and its collision shape: the box and every part drawn on
 *  it with `solid` or `block`, so that what is seen is what collides. */
export interface Hulled {
  body: Mesh;
  hull: Engine.PhysicsPart[];
}

/** What vehicles are built of: bodies, parts drawn on them, and wheels, the vehicle's own. */
export function vehicleParts({
  geometry,
  material,
  object,
}: Families<'geometry' | 'material' | 'object'>) {
  const paint = (color: string, extra: Paint = {}) =>
    material.meshStandard({ color, roughness: 0.45, metalness: 0.2, ...extra });
  const tyre = paint('#1d1f23', { roughness: 0.9, metalness: 0 });
  const hub = paint('#c9ccd1', { metalness: 0.8, roughness: 0.3 });
  const glow = (color: string) => paint(color, { emissive: color, emissiveIntensity: 2 });
  // A part drawn on a body: a mesh at `at`, never simulated on its own.
  const part = (parent: Mesh, shape: Shape, look: Look, at: Vec3, turn: Vec3 = [0, 0, 0]) => {
    const mesh = object.mesh(shape, look);
    mesh.position.set(...at);
    mesh.rotation.set(...turn);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // A wheel: a tyre whose axle runs along the body's x, placed where it rests on flat ground,
  // with a hub and a spoke to show it turn. Its radius and width are read from it.
  const wheel = ({ body }: Hulled, at: Vec3, radius: number, width: number) => {
    const tread = part(body, geometry.cylinder(radius, radius, width, 28), tyre, at, [
      0,
      0,
      Math.PI / 2,
    ]);
    part(tread, geometry.cylinder(radius * 0.62, radius * 0.62, width * 1.04, 20), hub, [0, 0, 0]);
    part(tread, geometry.box(radius * 1.5, width * 1.08, radius * 0.18), tyre, [0, 0, 0]);
    return tread;
  };
  const halves = (size: Vec3) => size.map((side) => side / 2) as Vec3;
  const chassis = (size: Vec3, color: string): Hulled => {
    const body = object.mesh(geometry.box(...size), paint(color));
    body.castShadow = body.receiveShadow = true;
    return { body, hull: [{ type: 'box', halfExtents: halves(size) }] };
  };
  const drawn = (shape: Solid) => {
    switch (shape.type) {
      case 'box':
        return geometry.box(...(shape.halfExtents.map((half) => half * 2) as Vec3));
      case 'sphere':
        return geometry.sphere(shape.radius, 20, 14);
      case 'cylinder':
        return geometry.cylinder(
          shape.radius,
          shape.radiusBottom ?? shape.radius,
          shape.halfHeight * 2,
          16,
        );
    }
  };
  const solid = ({ body, hull }: Hulled, shape: Solid, look: Look, at: Vec3, turn?: Vec3) => {
    const mesh = part(body, drawn(shape), look, at, turn);
    hull.push({ ...shape, position: at, quaternion: mesh.quaternion.toArray() });
  };
  const block = (on: Hulled, size: Vec3, look: Look, at: Vec3, turn?: Vec3) =>
    solid(on, { type: 'box', halfExtents: halves(size) }, look, at, turn);
  return { paint, glow, tyre, wheel, chassis, solid, block };
}
