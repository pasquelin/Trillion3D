import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';

/** The interactive session draws while it opens. Its host hears that first image only once it
 *  owns the session and has applied its settings: capability, diagnostic and capture need it. */
export function holdOpeningFrame() {
  let ready = false,
    first: FrameMetrics | undefined,
    dispatch: ((metrics: FrameMetrics) => void) | undefined;
  return {
    hold(listener: (metrics: FrameMetrics) => void) {
      dispatch = listener;
      return (metrics: FrameMetrics) => {
        if (ready) listener(metrics);
        else first = metrics;
      };
    },
    release() {
      ready = true;
      const metrics = first;
      first = undefined;
      if (metrics) dispatch?.(metrics);
    },
  };
}
