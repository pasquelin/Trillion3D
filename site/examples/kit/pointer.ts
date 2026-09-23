/** A point as the camera carries it, and its turn as a quaternion. */
type Xyz = { x: number; y: number; z: number };

/** The world as far as pointing goes: its canvas and its perspective camera. */
export interface PointerWorld {
  canvas: { getBoundingClientRect(): { left: number; top: number; width: number; height: number } };
  camera: { fov: number; position: Xyz; quaternion: Xyz & { w: number } };
}

/** `v` turned by the unit quaternion `q`. */
function turned({ x, y, z, w }: Xyz & { w: number }, [vx, vy, vz]: number[]) {
  const tx = 2 * (y * vz - z * vy),
    ty = 2 * (z * vx - x * vz),
    tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx,
  ];
}

/**
 * Where the pointer of `event` meets the level plane `y = height`: a ray from the camera
 * through the pointer, stopped by the plane. `[x, z]` of the point met, or `null` when the ray
 * runs parallel to the plane or away from it.
 */
export function pointerOnPlane(
  world: PointerWorld,
  event: { clientX: number; clientY: number },
  height = 0,
): [number, number] | null {
  const box = world.canvas.getBoundingClientRect(),
    { camera } = world,
    slope = Math.tan((camera.fov * Math.PI) / 360);
  const x = ((event.clientX - box.left) / box.width) * 2 - 1,
    y = 1 - ((event.clientY - box.top) / box.height) * 2;
  const ray = turned(camera.quaternion, [x * slope * (box.width / box.height), y * slope, -1]);
  const reach = (height - camera.position.y) / ray[1];
  if (!(reach > 0) || !Number.isFinite(reach)) return null;
  return [camera.position.x + ray[0] * reach, camera.position.z + ray[2] * reach];
}
