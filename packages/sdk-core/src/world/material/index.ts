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
  /** The usual material: a colour, how metallic it is and how rough it is. */
  meshStandard: kind('meshStandard'),
  /** The standard material plus glass, varnish and sheen. */
  meshPhysical: kind('meshPhysical', { ior: 1.5, thickness: 0, transmission: 0 }),
  /** A flat colour that ignores every light. */
  meshBasic: kind('meshBasic'),
  /** A shiny plastic look, with a bright spot where light bounces. */
  meshPhong: kind('meshPhong', { shininess: 30 }),
  /** A matte look, like chalk or paper. */
  meshLambert: kind('meshLambert'),
  /** A cartoon look, lit in a few flat bands. */
  meshToon: kind('meshToon'),
  /** Colours each point by the way its surface faces. */
  meshNormal: kind('meshNormal'),
  /** Lit by a picture of a lit ball instead of the scene's lights. */
  meshMatcap: kind('meshMatcap'),
  /** Shades each point by how far it is from the camera: white at `camera.near`, black at
   *  `camera.far`, a straight ramp between, the same on WebGPU and WebGL2. */
  meshDepth: kind('meshDepth'),
  /** Draws each vertex as a dot. */
  points: kind('points', { size: 1, sizeAttenuation: true }),
  /** Draws lines in one colour. */
  line: kind('line', { linewidth: 1 }),
  /** Draws dashed lines: `dashSize` drawn, then `gapSize` left empty, along the line. */
  lineDashed: kind('lineDashed', { linewidth: 1, dashSize: 3, gapSize: 1, scale: 1 }),
  /** A flat picture that always faces the camera (`object.sprite`), see-through where its
   *  picture is, turned in the image by `rotation` and smaller with distance unless
   *  `sizeAttenuation` is false. */
  sprite: kind('sprite', { rotation: 0, sizeAttenuation: true, transparent: true }),
  /** Invisible, except where shadows fall on it. */
  shadow: kind('shadow', { color: 0x000000, transparent: true, opacity: 0.5 }),
  /**
   * A material whose look is written by the page, in shader code.
   * @param p - The shader's vertex code, fragment code and uniforms.
   */
  createShader: (p: {
    vertex?: string;
    fragment?: string;
    uniforms?: Record<string, { value: unknown }>;
  }) => new Material('shader', { ...p }),
};

export { Material, type MaterialParameters };
