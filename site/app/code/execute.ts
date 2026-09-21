import { resolveSdkImports } from './resolveSdkImports.ts';

/** Execute one edited module off the UI thread. Each run owns and disposes its worker. */
export function executionSource(code, sdkUrl) {
  const resolved = resolveSdkImports(String(code), sdkUrl);
  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(resolved)}`;
  return `import(${JSON.stringify(moduleUrl)}).then(async module => {
    const value = await module.default;
    const text = JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? String(item) : ArrayBuffer.isView(item) ? Array.from(item) : item, 2);
    postMessage({ ok: true, text: (text ?? 'undefined').slice(0, 16000) });
  }).catch(error => postMessage({ ok: false, text: String(error.message ?? error).slice(0, 2000) }));`;
}

export function runModule(code, sdkUrl, { timeout = 3000, createWorker } = {}) {
  let dispose;
  const source = executionSource(code, sdkUrl);
  if (!createWorker)
    createWorker = (script) => {
      const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
      try {
        const worker = new Worker(url, { type: 'module' });
        dispose = () => URL.revokeObjectURL(url);
        return worker;
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
    };
  let cancel;
  const promise = new Promise((resolve) => {
    let worker, timer;
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker?.terminate();
      dispose?.();
      resolve(result);
    };
    cancel = () => finish({ ok: false, kind: 'cancelled' });
    try {
      worker = createWorker(source);
      worker.onmessage = ({ data }) => finish(data);
      worker.onerror = (event) => finish({ ok: false, text: event.message });
      timer = setTimeout(() => finish({ ok: false, kind: 'timeout' }), timeout);
    } catch (error) {
      finish({ ok: false, text: error.message });
    }
  });
  return { promise, cancel: () => cancel() };
}
