import type * as Engine from '../../../packages/sdk-browser/src/index.ts';

type Families = Pick<typeof Engine, 'geometry' | 'material' | 'object'>;
type Mesh = ReturnType<Families['object']['mesh']>;
type Node = Pick<Mesh, 'add'>;
type Shape = Parameters<Families['object']['mesh']>[0];
type Look = ReturnType<Families['material']['meshStandard']>;
type Paint = Omit<Parameters<Families['material']['meshStandard']>[0] & object, 'color'>;
type Vec3 = [number, number, number];
/** The primitives a body's drawn part collides as. */
type Solid = Exclude<Engine.PhysicsPrimitive, { type: 'capsule' }>;

/**
 * What vehicles are built of: bodies whose box carries the mass, parts drawn on them, and wheels.
 * A body and every part drawn on it with `solid` or `block` make its collision shape, `hulls`, so
 * that what is seen is what collides; its wheels are the vehicle's own.
 */
export function fleetBuilder({ geometry, material, object }: Families) {
  const paint = (color: string, extra: Paint = {}) =>
    material.meshStandard({ color, roughness: 0.45, metalness: 0.2, ...extra });
  const tyre = paint('#1d1f23', { roughness: 0.9, metalness: 0 });
  const hub = paint('#c9ccd1', { metalness: 0.8, roughness: 0.3 });
  const glow = (color: string) => paint(color, { emissive: color, emissiveIntensity: 2 });
  // A part drawn on a body: a mesh at `at`, never simulated on its own.
  const part = (parent: Node, shape: Shape, look: Look, at: Vec3, turn: Vec3 = [0, 0, 0]) => {
    const mesh = object.mesh(shape, look);
    mesh.position.set(...at);
    mesh.rotation.set(...turn);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // A wheel: a tyre whose axle runs along the body's x, placed where it rests on flat ground,
  // with a hub and a spoke to show it turn. Its radius and width are read from it.
  const wheel = (body: Mesh, at: Vec3, radius: number, width: number) => {
    const tread = part(body, geometry.cylinder(radius, radius, width, 28), tyre, at, [
      0,
      0,
      Math.PI / 2,
    ]);
    part(
      tread,
      geometry.cylinder(radius * 0.62, radius * 0.62, width * 1.04, 20),
      hub,
      [0, 0, 0],
    );
    part(tread, geometry.box(radius * 1.5, width * 1.08, radius * 0.18), tyre, [0, 0, 0]);
    return tread;
  };
  const hulls = new Map<Mesh, Engine.PhysicsPart[]>();
  const halves = (size: Vec3) => size.map((side) => side / 2) as Vec3;
  const chassis = (size: Vec3, color: string) => {
    const body = object.mesh(geometry.box(...size), paint(color));
    body.castShadow = body.receiveShadow = true;
    hulls.set(body, [{ type: 'box', halfExtents: halves(size) }]);
    return body;
  };
  const drawn = (shape: Solid) =>
    shape.type === 'box'
      ? geometry.box(...(shape.halfExtents.map((half) => half * 2) as Vec3))
      : shape.type === 'sphere'
        ? geometry.sphere(shape.radius, 20, 14)
        : geometry.cylinder(
            shape.radius,
            shape.radiusBottom ?? shape.radius,
            shape.halfHeight * 2,
            16,
          );
  const solid = (body: Mesh, shape: Solid, look: Look, at: Vec3, turn?: Vec3) => {
    const mesh = part(body, drawn(shape), look, at, turn);
    hulls.get(body)?.push({ ...shape, position: at, quaternion: mesh.quaternion.toArray() });
  };
  const block = (body: Mesh, size: Vec3, look: Look, at: Vec3, turn?: Vec3) =>
    solid(body, { type: 'box', halfExtents: halves(size) }, look, at, turn);
  return { paint, glow, tyre, wheel, chassis, solid, block, hulls };
}
