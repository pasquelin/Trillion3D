import type { XrFrame, XrHitSource, XrSession, XrSpace, XrTransform } from './platform.ts';

/** Owned optional session features: pending sources are cancelled even if the session ends first. */
export function createXrFeatures(
  session: () => XrSession | null,
  reference: () => XrSpace | null,
  replace: (space: XrSpace) => void,
) {
  const sources = new Map<XrHitSource, (hits: readonly XrTransform[]) => void>();
  let epoch = 0;
  return {
    frame(frame: XrFrame, space: XrSpace) {
      for (const [source, receive] of sources) {
        const hits: XrTransform[] = [];
        for (const hit of frame.getHitTestResults?.(source) ?? []) {
          const pose = hit.getPose(space);
          if (pose) hits.push(pose.transform);
        }
        receive(hits);
      }
    },
    clear() {
      epoch++;
      for (const source of sources.keys()) source.cancel();
      sources.clear();
    },
    api: {
      /** Moves the reference-space origin relative to its current placement; yaw is in radians. */
      teleport(position: { x: number; y: number; z: number }, yaw = 0) {
        const space = reference();
        if (!session() || !space) throw new Error('XR_INACTIVE: enter a session first');
        if (![position.x, position.y, position.z, yaw].every(Number.isFinite))
          throw new Error('XR_TELEPORT: finite position and yaw required');
        const Transform = (
          globalThis as unknown as {
            XRRigidTransform?: new (
              position: { x: number; y: number; z: number },
              orientation: { x: number; y: number; z: number; w: number },
            ) => XrTransform;
          }
        ).XRRigidTransform;
        if (!Transform) throw new Error('XR_TRANSFORM_UNAVAILABLE');
        const transform = new Transform(position, {
          x: 0,
          y: Math.sin(yaw / 2),
          z: 0,
          w: Math.cos(yaw / 2),
        });
        replace(space.getOffsetReferenceSpace(transform.inverse));
      },
      /** Viewer-ray AR hits, expressed in the same reference space as eyes and tracked inputs. */
      async hitTest(receive: (hits: readonly XrTransform[]) => void) {
        const current = session(),
          own = epoch;
        if (!current?.requestHitTestSource) throw new Error('XR_HIT_TEST_UNAVAILABLE');
        const space = await current.requestReferenceSpace('viewer');
        if (current !== session() || own !== epoch) throw new Error('XR_SESSION_ENDED');
        const source = await current.requestHitTestSource({ space });
        if (current !== session() || own !== epoch) {
          source.cancel();
          throw new Error('XR_SESSION_ENDED');
        }
        sources.set(source, receive);
        return () => {
          if (sources.delete(source)) source.cancel();
        };
      },
    },
  };
}
