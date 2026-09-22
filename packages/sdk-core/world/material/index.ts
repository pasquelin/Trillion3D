import { Material, type MaterialParameters } from './material.ts';

/** A member building one kind, with the values that kind starts from. */
const kind =
  (name: string, defaults: Partial<MaterialParameters> = {}) =>
  (parameters?: MaterialParameters) =>
    new Material(name, parameters, defaults);

/**
 * The `material` family: the matter alone. Every kind is lit by the engine's one surface model;
 * a kind is the values it starts from, and the family its name gives it in that model — unlit,
 * diffuse, toon, a view of normals, matcap or depth (`surfaceModel.ts`).
 */
export const material = {
  meshStandard: kind('meshStandard'),
  meshPhysical: kind('meshPhysical', { ior: 1.5, thickness: 0, transmission: 0 }),
  meshBasic: kind('meshBasic'),
  meshPhong: kind('meshPhong', { shininess: 30 }),
  meshLambert: kind('meshLambert'),
  meshToon: kind('meshToon'),
  meshNormal: kind('meshNormal'),
  meshMatcap: kind('meshMatcap'),
  meshDepth: kind('meshDepth'),
  points: kind('points', { size: 1, sizeAttenuation: true }),
  line: kind('line', { linewidth: 1 }),
  lineDashed: kind('lineDashed', { linewidth: 1, dashSize: 3, gapSize: 1 }),
  sprite: kind('sprite'),
  shadow: kind('shadow', { color: 0x000000, transparent: true, opacity: 0.5 }),
  createShader: (p: {
    vertex?: string;
    fragment?: string;
    uniforms?: Record<string, { value: unknown }>;
  }) => new Material('shader', { ...p }),
};

export { Material, type MaterialParameters };
