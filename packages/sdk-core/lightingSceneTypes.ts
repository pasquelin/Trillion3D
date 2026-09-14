/** Geometry shared by the experimental transport solver and its browser fixture. */
export type Vec3 = [number, number, number];

/** Linear RGB and a world-space panel centre. Zero intensity keeps the panel present. */
export interface LightingSceneLight {
  id: string;
  color: Vec3;
  intensity: number;
  position: Vec3;
}

/** origin is a corner; u and v span the complete rectangle. */
export interface Surface {
  id: string;
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  albedo: Vec3;
  emission: Vec3;
  kind: 'diffuse' | 'mirror';
  moving: boolean;
  columns: number;
  rows: number;
}

/** u and v span the complete cell; cross(u, v) points along normal. */
export interface Patch {
  id: number;
  surface: number;
  center: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  area: number;
  albedo: Vec3;
  emission: Vec3;
}

export interface Scene {
  surfaces: Surface[];
  patches: Patch[];
  sphere?: { center: Vec3; radius: number; roughness: number };
}
