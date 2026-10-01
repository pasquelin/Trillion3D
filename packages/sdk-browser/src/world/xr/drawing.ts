import type { BackendView } from '../../backend/view.ts';
import { xrFrameMetrics, type XrEyeMetrics } from './metrics.ts';
import { createXrTiming } from './timing.ts';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { createStereoCut } from '../../page/cut/stereo.ts';
import { createWebglRenderTarget } from '../../webgl/core/renderTarget.ts';
import { createFrameComposer } from '../render/compose.ts';
import type { BackendContext, RenderBackend } from '../../backend/types.ts';
import type { XrDrawing } from './session.ts';
import type { XrSession } from './platform.ts';
import { createXrCamera } from './camera.ts';
import { openXrBinding } from './binding.ts';
import type { XrGpuEye } from './renderTypes.ts';

/** Both images use the existing renderer and one residency cut; only their histories are private. */
export async function openXrDrawing(
  session: XrSession,
  inputs: {
    transparent?: boolean;
    context: BackendContext;
    backend: RenderBackend;
    device?: GPUDevice;
    gl?: WebGL2RenderingContext;
    particleStep?: ReturnType<typeof createFrameComposer>['particleStep'];
    render(draw: (backend: RenderBackend) => XrEyeMetrics): void;
  },
): Promise<XrDrawing> {
  const { context, backend, device, gl } = inputs;
  const binding = await openXrBinding(session, device, gl);
  const timing = createXrTiming();
  const cut = createStereoCut();
  cut.transparent = inputs.transparent;
  const cameras = [createXrCamera(), createXrCamera()];
  const lenses = cameras.map(() => ({
    camera: createEngineCamera(),
    viewport: [1, 1] as [number, number],
  }));
  const gpuEyes: XrGpuEye[] = [];
  const glEyes: {
    view: BackendView;
    target: ReturnType<typeof createWebglRenderTarget>;
    compose: ReturnType<typeof createFrameComposer>;
  }[] = [];
  let disposed = false;
  let releasing: Promise<void> | undefined;
  const dispose = () => {
    if (disposed) return releasing!;
    disposed = true;
    const jobs = [
      ...gpuEyes.map((eye) => () => eye.dispose()),
      ...glEyes.flatMap((eye) => [
        () => eye.view.release(),
        () => eye.compose.dispose(),
        () => eye.target.dispose(),
      ]),
    ];
    releasing = Promise.allSettled(jobs.map(async (release) => release())).then((results) => {
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      try {
        binding.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, 'XR_RELEASE_FAILED');
    });
    return releasing;
  };
  try {
    if (binding.gpu) {
      if (!backend.createXrEye) throw new Error('XR_BACKEND_UNSUPPORTED');
      for (let i = 0; i < 2; i++) gpuEyes.push(await backend.createXrEye(1, 1));
    } else {
      if (!backend.addView) throw new Error('XR_BACKEND_UNSUPPORTED');
      for (const { camera } of cameras)
        glEyes.push({
          view: await backend.addView({ x: 0, y: 0, width: 1, height: 1 }),
          target: createWebglRenderTarget(gl!, 1, 1),
          compose: createFrameComposer(gl!, camera, {
            transparent: inputs.transparent,
            effects: context.effects && { chain: context.effects, shown: () => true },
            guides: context.guides,
            pixelRatio: () => 1,
            particles: context.particles,
            particlesRefused: context.particlesRefused,
            particleStep: inputs.particleStep,
          }),
        });
    }
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    dispose,
    createLayer: binding.layers?.create,
    get timing() {
      return timing.current;
    },
    draw(_frame, _space, views, time) {
      if (disposed) return;
      if (views.length < 1 || views.length > 2) throw new Error('XR_VIEW_COUNT_UNSUPPORTED');
      const previous = context.stereo;
      try {
        const started = timing.start(time, session.frameRate);
        binding.layers?.frame(_frame);
        const targets = views.map((view) => binding.gpu?.(view));
        const rects = views.map((view, i) => targets[i]?.viewport ?? binding.gl!.getViewport(view));
        for (let i = 0; i < views.length; i++) {
          const { width, height } = rects[i];
          if (!(width > 0 && height > 0)) throw new Error('XR_VIEWPORT_INVALID');
          cameras[i].update(views[i], width, height, !!binding.gpu);
          readCameraWorld(lenses[i].camera, cameras[i].camera, width / height);
          lenses[i].viewport[0] = width;
          lenses[i].viewport[1] = height;
        }
        cut.begin(lenses.slice(0, views.length));
        context.stereo = cut;
        inputs.render((active) => {
          if (disposed) return {};
          if (active !== backend) throw new Error('XR_BACKEND_REPLACED');
          const metrics: XrEyeMetrics[] = [];
          for (let i = 0; i < views.length; i++) {
            const eyeStart = performance.now();
            if (targets[i]) metrics.push({ ...gpuEyes[i].draw(cameras[i].camera, targets[i]!) });
            else {
              const { view, target, compose } = glEyes[i],
                { x, y, width, height } = binding.gl!.getViewport(views[i]);
              target.resize(width, height);
              view.resize({ x: 0, y: 0, width, height });
              view.render(cameras[i].camera, () => {
                compose(backend, target, false);
                metrics.push({ ...backend.metrics() });
              });
              gl!.bindFramebuffer(gl!.READ_FRAMEBUFFER, target.framebuffer);
              gl!.bindFramebuffer(gl!.DRAW_FRAMEBUFFER, binding.gl!.framebuffer);
              gl!.disable(gl!.SCISSOR_TEST);
              gl!.blitFramebuffer(
                0,
                0,
                width,
                height,
                x,
                y,
                x + width,
                y + height,
                gl!.COLOR_BUFFER_BIT,
                gl!.NEAREST,
              );
            }
            timing.eye(i, eyeStart);
          }
          return xrFrameMetrics(metrics, cut.nodesTested);
        });
        timing.end(started);
      } finally {
        context.stereo = previous;
        if ('endFrame' in binding) binding.endFrame?.();
        if (gl) {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        }
      }
    },
  };
}
