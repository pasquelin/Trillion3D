/** CPU submission costs, separate from unavailable GPU timestamps and headset display latency. */
export function createXrTiming() {
  const eyeCpuMs: number[] = [];
  let frameCpuMs = 0,
    frame = 0,
    intervalMs: number | null = null,
    budgetMs: number | null = null,
    previous: number | null = null;
  return {
    start(time: number, rate?: number) {
      budgetMs = rate && Number.isFinite(rate) && rate > 0 ? 1000 / rate : null;
      intervalMs = previous !== null && time > previous ? time - previous : null;
      previous = time;
      eyeCpuMs.length = 0;
      return performance.now();
    },
    eye(index: number, started: number) {
      eyeCpuMs[index] = performance.now() - started;
    },
    end(started: number) {
      frameCpuMs = performance.now() - started;
      frame++;
    },
    get current() {
      return {
        frame,
        eyeCpuMs: [...eyeCpuMs],
        frameCpuMs,
        gpuMs: null,
        intervalMs,
        budgetMs,
        cpuOverBudget: budgetMs === null ? null : frameCpuMs > budgetMs,
        renderScale: 1 as const,
      };
    },
  };
}
