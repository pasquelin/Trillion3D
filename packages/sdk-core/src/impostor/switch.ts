/**
 * When a distant object becomes its impostor, derived from the baked data and the view and never
 * tuned (#817, "When to switch"; runtime card #1239). With `f` the focal length in pixels, `z` the
 * view depth of the pivot, `R` the object radius times the largest world scale of the mesh's
 * placements, `T` the DAG root's triangles, `c` the baked mean coverage and `r_f` the frame side
 * in texels:
 *
 * - Atlas sharp (at most one texel per pixel): `2R·f/z ≤ r_f` ⇒ `z ≥ z_tex = 2R·f / r_f`.
 * - Root more costly than the pixels it covers: `T ≥ c·π(R·f/z)²` ⇒ `z ≥ z_tri = R·f·√(cπ/T)`.
 *
 * The switch is `z_s = max(z_tex, z_tri)`; the impostor draws when `z ≥ z_s`. `f` is the engine's
 * one focal length in pixels (`pixelScaleOf` on the CPU, `focalPixels()` in WGSL); `T`, `c`, `R`
 * and `r_f` come only from the baked manifest.
 */
import { impostorMeshBaked, type ImpostorMesh } from '../contracts/impostor.ts';

/** π, one literal, so every reader of the switch rounds the same number. */
export const IMPOSTOR_PI = 3.141592653589793;

/** `z_tex`: the depth from which a frame of `frameSide` texels is at most one texel per pixel. */
export function impostorTexelDepth(radius: number, frameSide: number, focalPixels: number): number {
  return (2 * radius * focalPixels) / frameSide;
}

/** `z_tri`: the depth from which the root's `rootTriangles` outnumber the pixels it covers. */
export function impostorTriangleDepth(
  radius: number,
  rootTriangles: number,
  coverage: number,
  focalPixels: number,
): number {
  return radius * focalPixels * Math.sqrt((coverage * IMPOSTOR_PI) / rootTriangles);
}

/** `R`: the object-space radius at the largest world scale a placement of the mesh gives it. */
export function impostorRadius(objectRadius: number, maxWorldScale = 1): number {
  return objectRadius * maxWorldScale;
}

/** The four baked numbers the switch reads, plus the placement scale. */
export interface ImpostorSwitchInput {
  /** Object-space bounding radius `objectRadius`. */
  objectRadius: number;
  /** The DAG root's triangles `T`. */
  rootTriangles: number;
  /** The baked mean coverage `c`. */
  coverage: number;
  /** The frame side in texels `r_f`. */
  frameSide: number;
  /** Largest world scale of the mesh's placements; one when unknown. */
  maxWorldScale?: number;
}

/** `z_s = max(z_tex, z_tri)` in metres for the runtime focal length `focalPixels`. */
export function impostorSwitchDepth(input: ImpostorSwitchInput, focalPixels: number): number {
  const radius = impostorRadius(input.objectRadius, input.maxWorldScale);
  return Math.max(
    impostorTexelDepth(radius, input.frameSide, focalPixels),
    impostorTriangleDepth(radius, input.rootTriangles, input.coverage, focalPixels),
  );
}

/** Whether the impostor draws at `viewDepth`, the pivot's view depth in metres. */
export function drawsImpostor(
  input: ImpostorSwitchInput,
  focalPixels: number,
  viewDepth: number,
): boolean {
  return viewDepth >= impostorSwitchDepth(input, focalPixels);
}

/**
 * The switch input a baked manifest entry carries, or `undefined` when the entry is refused or
 * misses one of the four numbers. An object is eligible only when its mesh has a `baked` entry.
 */
export function impostorSwitchOf(
  mesh: ImpostorMesh,
  maxWorldScale = 1,
): ImpostorSwitchInput | undefined {
  if (!impostorMeshBaked(mesh)) return undefined;
  const { objectRadius, rootTriangles, coverage, frameSide } = mesh;
  if (
    !Number.isFinite(objectRadius) ||
    (objectRadius as number) <= 0 ||
    !Number.isFinite(rootTriangles) ||
    rootTriangles <= 0 ||
    !Number.isFinite(coverage) ||
    (coverage as number) <= 0
  )
    return undefined;
  return {
    objectRadius: objectRadius as number,
    rootTriangles,
    coverage: coverage as number,
    frameSide,
    maxWorldScale,
  };
}
