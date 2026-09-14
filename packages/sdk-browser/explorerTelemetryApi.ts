import type { EngineProfiler, TelemetryReport } from './telemetry.ts';

export function createExplorerTelemetryApi(profiler: EngineProfiler) {
  return {
    profiler,
    getReport(): TelemetryReport {
      return profiler.getReport();
    },
    printReport() {
      profiler.printReport();
    },
    enableAutoLog(intervalSeconds = 2) {
      return profiler.startAutoLog(intervalSeconds);
    },
    disableAutoLog() {
      profiler.stopAutoLog();
    },
  };
}
