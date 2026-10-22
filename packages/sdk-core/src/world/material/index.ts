import { Material } from './material.ts'
import type { MaterialParameters } from './materialParameters.ts'
import { DEFAULT_IOR, DEFAULT_SHININESS } from './defaults.ts'
import { MaterialGraph } from './graph/api.ts'
import type { MaterialDomain } from '../../contracts/volumeMaterial.ts'

/** A member building one kind, with the values that kind starts from. */
const kind =
  (name: string, defaults: Partial<MaterialParameters> = {}) =>
  (parameters?: MaterialParameters) =>
    new Material(name, parameters, defaults)

/**
 * The `material` family: the matter alone. Every kind is lit by the engine's one surface model;
 * a kind is the values it starts from, and the family its name gives it in that model — unlit,
 * diffuse, toon, a view of normals, matcap or depth (`surfaceModel.ts`).
 */
export const material = {
  /** The usual material: a colour, how metallic it is and how rough it is. */
  meshStandard: kind('meshStandard'),
  /** The standard material plus glass, varnish and sheen. */
  meshPhysical: kind('meshPhysical', { ior: DEFAULT_IOR, thickness: 0, transmission: 0 }),
  /** A flat colour that ignores every light. */
  meshBasic: kind('meshBasic'),
  /** A shiny plastic look, with a bright spot where light bounces. */
  meshPhong: kind('meshPhong', { shininess: DEFAULT_SHININESS }),
  /** A matte look, like chalk or paper. */
  meshLambert: kind('meshLambert'),
  /** A cartoon look, lit in a few flat bands. */
  meshToon: kind('meshToon'),
  /** Colours each point by the way its surface faces. */
  meshNormal: kind('meshNormal'),
  /** Lit by a picture of a lit ball instead of the scene's lights. */
  meshMatcap: kind('meshMatcap'),
  /** Shades each point by how far it is from the camera: white at `camera.near`, black at
   *  `camera.far`, a straight ramp between. */
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
  /**
   * A material of the volume domain: its mesh is drawn as no surface; the box it fills (its
   * geometry's bounds, placed by its pose) is voxelised into the fog's volume, where it adds
   * `albedo` times `extinction` of scattering, `extinction`, and `emissive` times
   * `emissiveIntensity` of light, per metre. It needs the scene's fog to have a volume
   * (the sky module's `heightFog.volumetric`).
   */
  volume: kind('volume', { albedo: 0xffffff, extinction: 0, emissiveOnly: false }),
  /**
   * A material of the light function domain: what a light that wears it (`light.lightFunction`)
   * multiplies its colour by, at each point its projection maps to a coordinate of the material.
   * The colour it gives is its emission: `emissive` times `emissiveIntensity`, times `emissiveMap`
   * read at that coordinate (the map's own wrap, filters, repeat, offset and rotation apply), white
   * by default; a `graph` wired to its `emissive` output gives it instead. It has no world position
   * and no depth, so it is drawn once into an atlas slot. A mesh that wears it is drawn with the
   * default material, as the material a domain cannot draw falls back to.
   */
  lightFunction: kind('lightFunction', { emissive: 0xffffff }),
  /**
   * A new, empty material graph for `domain` — `'surface'`, `'lightFunction'` or `'volume'` —: nodes
   * wired into the outputs the domain reads, compiled to the shader that computes them. A material
   * of that domain wears it with `{ graph }` (`material.lightFunction({ graph })`); its outputs then
   * replace the parameters they stand for. See `MaterialGraph`.
   * @param domain - The domain whose outputs the graph is wired into.
   */
  graph: (domain: MaterialDomain) => new MaterialGraph(domain),
  /** Invisible, except where shadows fall on it. */
  shadow: kind('shadow', { color: 0x000000, transparent: true, opacity: 0.5 }),
  /**
   * A material that holds shader code for the page's own use. The engine runs no shader code a
   * page writes: a mesh wearing it is drawn with the default standard surface, and `scene.toJSON`
   * refuses it (`SCENE_NOT_SAVABLE`).
   * @param p - The shader's vertex code, fragment code and uniforms, kept as given.
   */
  createShader: (p: {
    vertex?: string
    fragment?: string
    uniforms?: Record<string, { value: unknown }>
  }) => new Material('shader', { ...p }),
}

export { Material, MaterialGraph, type MaterialParameters }
