function active(signal: AbortSignal): void { signal.throwIfAborted(); }
export function nextFrame(signal: AbortSignal): Promise<number> {
  active(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { cancelAnimationFrame(id); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const id = requestAnimationFrame(time => { signal.removeEventListener('abort', abort); resolve(time); });
    signal.addEventListener('abort', abort, { once: true });
  });
}
