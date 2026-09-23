/** Geometry shared by the experimental transport solver and its browser fixture. */
export type Vec3 = [number, number, number];

/** Linear RGB and a world-space panel centre. Zero intensity keeps the panel present. */
export interface LightingSceneLight {
  /** The light's name. */
  id: string;
  /** Its colour, linear RGB. */
  color: Vec3;
  /** How strong it is. */
  intensity: number;
  /** The panel's centre. */
  position: Vec3;
}

/** origin is a corner; u and v span the complete rectangle. */
export interface Surface {
  /** The surface's name. */
  id: string;
  /** One corner. */
  origin: Vec3;
  /** The first side from that corner. */
  u: Vec3;
  /** The second side from that corner. */
  v: Vec3;
  /** How much light it reflects, per colour. */
  albedo: Vec3;
  /** Light it gives off, per colour. */
  emission: Vec3;
  /** Matte or mirror. */
  kind: 'diffuse' | 'mirror';
  /** Whether it moves. */
  moving: boolean;
  /** Patches across. */
  columns: number;
  /** Patches up. */
  rows: number;
}

/** u and v span the complete cell; cross(u, v) points along normal. */
export interface Patch {
  /** The patch's number. */
  id: number;
  /** Its surface's number. */
  surface: number;
  /** Its middle. */
  center: Vec3;
  /** The way it faces. */
  normal: Vec3;
  /** Its first side. */
  u: Vec3;
  /** Its second side. */
  v: Vec3;
  /** Its area. */
  area: number;
  /** How much light it reflects. */
  albedo: Vec3;
  /** Light it gives off. */
  emission: Vec3;
}

/** The test scene of the experimental light-bounce solver: surfaces cut into patches. */
export interface Scene {
  /** Its surfaces. */
  surfaces: Surface[];
  /** Its patches. */
  patches: Patch[];
  /** An optional shiny ball. */
  sphere?: { center: Vec3; radius: number; roughness: number };
}
