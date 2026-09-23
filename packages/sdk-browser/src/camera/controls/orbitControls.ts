import { createChangeGate, createControlBase } from './base.ts';
import { pivotControlsApi, trackPivotGestures } from './pivot.ts';
import { controlPose, readVector, writeVector } from './pose.ts';
import {
  clampAzimuth,
  dollyDistance,
  orbitOrientation,
  panOffset,
  pixelWorldScale,
} from './math.ts';
import {
  clampNumber,
  fromSpherical,
  POLAR_EPSILON,
  RADIUS_EPSILON,
  toSpherical,
} from '../../../../sdk-core/src/world/math/spherical.ts';
import type { ControlCamera, PivotCameraControls } from './types.ts';

/**
 * ORBIT, the turntable: the camera turns around `target` at a distance the host bounds, world
 * up kept, so a horizontal drag is an azimuth and a vertical one an elevation. Primary drag
 * rotates, secondary drag or two fingers pan, wheel and pinch zoom between `minDistance` and
 * `maxDistance`. No damping: a pointer that stops, stops the camera, and the scene is still.
 *
 * THE POSE IS THE STATE. Every gesture starts by reading `object.position` and `target` back
 * into spherical coordinates, and ends by writing them out again. A host that moves the
 * camera itself — the portal's zoom buttons do — is therefore understood on the next
 * `update()`, and the round trip is what `math.test.ts` pins down.
 *
 * THE ANGLES ARE BOUNDED like the distance, on every drag and every `update()`: the polar
 * angle between `minPolarAngle` and `maxPolarAngle`, the azimuth on the arc from
 * `minAzimuthAngle` to `maxAzimuthAngle`. Their names and meanings are the ones web 3D
 * libraries commonly use, so a page that already sets them keeps its numbers.
 */
export interface OrbitCameraControls extends PivotCameraControls {
  /**
   * Smallest polar angle, in radians from straight up: `0` lets the camera look straight
   * down. The pole itself stays out of reach, where the azimuth would stop being defined.
   */
  minPolarAngle: number;
  /** Largest polar angle, in radians from straight up: `Math.PI / 2` keeps it above the ground. */
  maxPolarAngle: number;
  /**
   * Start of the arc of azimuth allowed, in radians from +Z towards +X; unlimited at
   * `-Infinity`. Only a pair of finite bounds narrower than a full turn holds the camera.
   */
  minAzimuthAngle: number;
  /** End of that arc; unlimited at `Infinity`. It may be smaller than `minAzimuthAngle`. */
  maxAzimuthAngle: number;
}

export function createOrbitCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): OrbitCameraControls {
  const pose = controlPose(camera),
    base = createControlBase();
  const position = new Float64Array(3),
    center = new Float64Array(3),
    offset = new Float64Array(3),
    spherical = new Float64Array(3),
    orientation = new Float64Array(4),
    pan = new Float64Array(3),
    moved = new Float64Array(6);
  const gate = createChangeGate(base, 6);
  const height = () => surface.clientHeight || 1;
  const sample = () => {
    pose.readPosition(position);
    readVector(center, api.target);
    for (let i = 0; i < 3; i++) offset[i] = position[i] - center[i];
    toSpherical(spherical, offset);
  };
  const apply = () => {
    const far = Math.max(api.maxDistance, api.minDistance, RADIUS_EPSILON);
    spherical[0] = clampNumber(spherical[0], Math.max(api.minDistance, RADIUS_EPSILON), far);
    spherical[1] = clampAzimuth(spherical[1], api.minAzimuthAngle, api.maxAzimuthAngle);
    spherical[2] = clampNumber(
      spherical[2],
      Math.max(api.minPolarAngle, POLAR_EPSILON),
      Math.min(api.maxPolarAngle, Math.PI - POLAR_EPSILON),
    );
    fromSpherical(offset, spherical);
    for (let i = 0; i < 3; i++) position[i] = center[i] + offset[i];
    pose.write(position, orbitOrientation(orientation, spherical));
    writeVector(api.target, center);
    moved.set(position);
    moved.set(center, 3);
    return gate(moved);
  };
  const rotate = (dx: number, dy: number) => {
    sample();
    spherical[1] -= (2 * Math.PI * dx * api.rotateSpeed) / height();
    spherical[2] -= (2 * Math.PI * dy * api.rotateSpeed) / height();
    apply();
  };
  const panBy = (dx: number, dy: number) => {
    if (!api.enablePan) return;
    sample();
    orbitOrientation(orientation, spherical);
    panOffset(pan, orientation, dx, dy, pixelWorldScale(spherical[0], pose.fov(), height()));
    for (let i = 0; i < 3; i++) center[i] += pan[i];
    apply();
  };
  const dolly = (steps: number) => {
    if (!api.enableZoom) return;
    sample();
    spherical[0] = dollyDistance(spherical[0], steps, api.zoomSpeed);
    apply();
  };
  // Unbounded angles by default: only the poles are out of reach.
  const api: OrbitCameraControls = Object.assign(
    pivotControlsApi(base, pose, () => {
      sample();
      return apply();
    }),
    {
      minPolarAngle: 0,
      maxPolarAngle: Math.PI,
      minAzimuthAngle: -Infinity,
      maxAzimuthAngle: Infinity,
    },
  );
  // A wheel notch is 5 % of the distance.
  trackPivotGestures(
    surface,
    base,
    (dx, dy, button, event) => (button === 0 && !event.shiftKey ? rotate(dx, dy) : panBy(dx, dy)),
    panBy,
    dolly,
  );
  return api;
}
