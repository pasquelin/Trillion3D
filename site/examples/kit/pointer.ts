/** A point or a direction as the engine's vectors carry it. */
type Xyz = { x: number; y: number; z: number };

/** The world as far as pointing goes: its canvas and its camera. */
export interface PointerWorld {
  canvas: { getBoundingClientRect(): { left: number; top: number; width: number; height: number } };
  camera: { rayThrough(x: number, y: number, aspect: number): { origin: Xyz; direction: Xyz } };
}

/**
 * Where the pointer of `event` meets the level plane `y = height`: the camera's own ray through
 * the pointer (`camera.rayThrough`, perspective or orthographic), stopped by the plane. `[x, z]`
 * of the point met, or `null` when the ray runs parallel to the plane or away from it.
 */
export function pointerOnPlane(
  world: PointerWorld,
  event: { clientX: number; clientY: number },
  height = 0,
): [number, number] | null {
  const box = world.canvas.getBoundingClientRect();
  const x = ((event.clientX - box.left) / box.width) * 2 - 1,
    y = 1 - ((event.clientY - box.top) / box.height) * 2;
  const { origin, direction } = world.camera.rayThrough(x, y, box.width / box.height);
  const reach = (height - origin.y) / direction.y;
  if (!(reach > 0) || !Number.isFinite(reach)) return null;
  return [origin.x + direction.x * reach, origin.z + direction.z * reach];
}
