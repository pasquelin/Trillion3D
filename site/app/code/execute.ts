import { resolveSdkImports } from './resolveSdkImports.ts';

/** What one run of an edited module reports: its value as text, or why it has none. */
export interface ModuleExecutionResult {
  ok: boolean;
  kind?: 'cancelled' | 'timeout';
  text?: string;
}

export interface ModuleExecutionTask {
  promise: Promise<ModuleExecutionResult>;
  cancel: () => void;
}

/** The part of a worker the runner drives; node tests adapt a `worker_threads` worker to it. */
export type ModuleWorker = Pick<Worker, 'onmessage' | 'onerror' | 'terminate'>;

interface RunOptions {
  timeout?: number;
  createWorker?: (script: string) => ModuleWorker;
}

/** Execute one edited module off the UI thread. Each run owns and disposes its worker. */
export function executionSource(code: string, sdkUrl: string) {
  const resolved = resolveSdkImports(String(code), sdkUrl);
  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(resolved)}`;
  return `import(${JSON.stringify(moduleUrl)}).then(async module => {
    const value = await module.default;
    const text = JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? String(item) : ArrayBuffer.isView(item) ? Array.from(item) : item, 2);
    postMessage({ ok: true, text: (text ?? 'undefined').slice(0, 16000) });
  }).catch(error => postMessage({ ok: false, text: String(error.message ?? error).slice(0, 2000) }));`;
}

export function runModule(
  code: string,
  sdkUrl: string,
  { timeout = 3000, createWorker }: RunOptions = {},
): ModuleExecutionTask {
  let dispose: (() => void) | undefined;
  const source = executionSource(code, sdkUrl);
  const spawn =
    createWorker ??
    ((script: string) => {
      const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
      try {
        const worker = new Worker(url, { type: 'module' });
        dispose = () => URL.revokeObjectURL(url);
        return worker;
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
    });
  let cancel: () => void = () => {};
  const promise = new Promise<ModuleExecutionResult>((resolve) => {
    let worker: ModuleWorker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const finish = (result: ModuleExecutionResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker?.terminate();
      dispose?.();
      resolve(result);
    };
    cancel = () => finish({ ok: false, kind: 'cancelled' });
    try {
      worker = spawn(source);
      worker.onmessage = (event: MessageEvent<ModuleExecutionResult>) => finish(event.data);
      worker.onerror = (event) => finish({ ok: false, text: event.message });
      timer = setTimeout(() => finish({ ok: false, kind: 'timeout' }), timeout);
    } catch (error) {
      finish({ ok: false, text: error instanceof Error ? error.message : undefined });
    }
  });
  return { promise, cancel: () => cancel() };
}
