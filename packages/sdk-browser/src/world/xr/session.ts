import { createXrReleases } from './releases.ts';
import { requestXrSession } from './request.ts';
import type { XrLayerKind, XrLayerOptions, XrLayerHandle } from './layers.ts';
import { createXrFeatures } from './features.ts';
import { createXrInputs } from './input.ts';
import {
  xrSystem,
  type XrFrame,
  type XrMode,
  type XrReference,
  type XrSession,
  type XrSpace,
  type XrSystem,
  type XrView,
} from './platform.ts';
/** A renderer uses the world's existing context, residency and persistent view state. */
export interface XrDrawing {
  readonly timing?: ReturnType<typeof import('./timing.ts').createXrTiming>['current'];
  createLayer?(kind: XrLayerKind, options: XrLayerOptions): XrLayerHandle;
  draw(frame: XrFrame, space: XrSpace, views: readonly XrView[], time: number): void;
  dispose(): void | Promise<void>;
}
export interface XrEnterOptions {
  referenceSpace?: XrReference;
  requiredFeatures?: readonly string[];
  optionalFeatures?: readonly string[];
}
export interface XrHost {
  open(session: XrSession, mode: XrMode): Promise<XrDrawing>;
  active(on: boolean): void;
  failed(error: unknown): void;
  system?: () => XrSystem | undefined;
  compatible?: () => boolean | Promise<boolean>;
  requiredFeatures?: () => readonly string[];
  beforeEnter?(): void;
}
/** One immersive session; opening, rendering and end all release the same owned resources. */
export function createWorldXr(host: XrHost, releases = createXrReleases(host.failed)) {
  const input = createXrInputs();
  let session: XrSession | null = null,
    reference: XrSpace | null = null;
  let drawing: XrDrawing | null = null,
    request = 0,
    generation = 0,
    disposed = false,
    openingRenderer = false;
  let pending: Promise<void> | null = null;
  const system = host.system ?? xrSystem;
  const features = createXrFeatures(
    () => session,
    () => reference,
    (space) => {
      reference = space;
    },
  );
  const cleanup = () => {
    if (!session) return releases.wait();
    session.cancelAnimationFrame(request);
    session.removeEventListener('end', ended);
    session.removeEventListener('inputsourceschange', sourcesChanged);
    session = null;
    reference = null;
    const owned = drawing;
    drawing = null;
    try {
      return releases.wait(owned?.dispose());
    } finally {
      input.clear();
      features.clear();
      host.active(false);
    }
  };
  const ended = () => {
    generation++;
    cleanup();
  };
  const sourcesChanged = () => input.sync(session?.inputSources ?? []);
  const frame = (time: number, current: XrFrame) => {
    if (current.session !== session || !reference || !drawing) return;
    try {
      if (session.visibilityState !== 'hidden') {
        const pose = current.getViewerPose(reference);
        input.update(current, reference);
        features.frame(current, reference);
        if (current.session !== session || !reference || !drawing) return;
        if (pose) drawing.draw(current, reference, pose.views, time);
      }
      if (session) request = session.requestAnimationFrame(frame);
    } catch (error) {
      host.failed(error);
      const failed = session;
      ended();
      releases.wait(failed?.end());
    }
  };
  const enter = (mode: XrMode, options: XrEnterOptions = {}) => {
    if (disposed) return Promise.reject(new Error('XR_DISPOSED: world disposed'));
    if (pending || session)
      return Promise.reject(new Error('XR_ACTIVE: a session is already opening or active'));
    const xr = system();
    if (!xr)
      return Promise.reject(new Error('XR_UNAVAILABLE: WebXR requires a supported secure browser'));
    const own = ++generation;
    const opening = requestXrSession(xr, host, mode, options);
    pending = (async () => {
      const granted = await opening;
      if (own !== generation || disposed) {
        await granted.end();
        return;
      }
      session = granted;
      session.addEventListener('end', ended);
      session.addEventListener('inputsourceschange', sourcesChanged);
      try {
        host.active(true);
        reference = await granted
          .requestReferenceSpace(options.referenceSpace ?? 'local-floor')
          .catch((error) => {
            if (options.referenceSpace) throw error;
            return granted.requestReferenceSpace('local');
          });
        if (session !== granted) return;
        openingRenderer = true;
        const made = await host.open(granted, mode);
        openingRenderer = false;
        if (session !== granted) {
          await releases.wait(made.dispose());
          return;
        }
        drawing = made;
        sourcesChanged();
        request = granted.requestAnimationFrame(frame);
      } catch (error) {
        openingRenderer = false;
        if (session === granted) cleanup();
        await granted.end().catch(() => {});
        throw error;
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
  return {
    ...features.api,
    /** Creates a browser-composited image layer owned by the active session. */
    createLayer(kind: XrLayerKind, options: XrLayerOptions) {
      if (!drawing?.createLayer) throw new Error('XR_LAYERS_UNAVAILABLE');
      return drawing.createLayer(kind, options);
    },
    /** Whether the browser can grant the requested immersive mode. */
    supported: async (mode: XrMode) =>
      (await (host.compatible?.() ?? true)) &&
      (await (system()?.isSessionSupported(mode) ?? false)),
    /** Enters the requested immersive mode from a user action. */
    enter,
    /** Enters immersive VR from a user action. */
    enterVR: (options?: XrEnterOptions) => enter('immersive-vr', options),
    /** Enters immersive AR with transparent surroundings from a user action. */
    enterAR: (options?: XrEnterOptions) => enter('immersive-ar', options),
    /** Measured CPU submission and native headset budget; unknown GPU timings stay null. */
    get timing() {
      return drawing?.timing ?? null;
    },
    /** The active native XR session, or null while inactive. */
    get session() {
      return session;
    },
    /** The current shared space for headset, inputs and hit tests, or null. */
    get referenceSpace() {
      return reference;
    },
    /** Tracked input nodes are in the reference space; add meshes as their children. */
    get inputs() {
      return input.values();
    },
    /** Replaces the space used for headset poses, inputs and hit tests together. */
    setReferenceSpace(space: XrSpace) {
      if (!session) throw new Error('XR_INACTIVE: enter a session first');
      reference = space;
    },
    /** Ends immersion and waits for all borrowed eye resources to be released. */
    async exit() {
      generation++;
      const current = session;
      const released = cleanup();
      await releases.wait(current?.end(), released);
      await pending;
    },
    /** Permanently stops XR entry and drains resources when the world is disposed. */
    dispose() {
      if (disposed) return releases.wait();
      disposed = true;
      generation++;
      const current = session;
      const released = cleanup();
      return releases.wait(current?.end(), released, openingRenderer ? pending : null);
    },
  };
}
