import type { XrHost, XrEnterOptions } from './session.ts';
import type { XrSystem, XrMode } from './platform.ts';

/** Preserve user activation; preflight and browser errors reject the same entry promise. */
export function requestXrSession(
  xr: XrSystem,
  host: XrHost,
  mode: XrMode,
  options: XrEnterOptions,
) {
  try {
    host.beforeEnter?.();
    return xr.requestSession(mode, {
      requiredFeatures: [
        ...new Set([...(host.requiredFeatures?.() ?? []), ...(options.requiredFeatures ?? [])]),
      ],
      optionalFeatures: [
        ...new Set([
          options.referenceSpace ?? 'local-floor',
          'hand-tracking',
          'layers',
          ...(mode === 'immersive-ar' ? ['hit-test'] : []),
          ...(options.optionalFeatures ?? []),
        ]),
      ],
    });
  } catch (error) {
    return Promise.reject(error);
  }
}
