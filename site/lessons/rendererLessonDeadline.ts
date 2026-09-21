export function createRendererLessonDeadline(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let rejectLimit: (error: DOMException) => void,
    pending = true;
  const limit = new Promise<never>((_, reject) => {
    rejectLimit = reject;
  });
  limit.catch(() => {});
  const stop = (error: DOMException) => {
    if (controller.signal.aborted) return;
    const reject = pending;
    pending = false;
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', cancel);
    controller.abort(error);
    if (reject) rejectLimit(error);
  };
  const cancel = () => stop(new DOMException('Cancelled', 'AbortError'));
  const timer = setTimeout(
    () => stop(new DOMException(`Startup exceeded ${timeoutMs} ms`, 'TimeoutError')),
    timeoutMs,
  );
  if (parentSignal?.aborted) cancel();
  else parentSignal?.addEventListener('abort', cancel, { once: true });
  return {
    signal: controller.signal,
    wait: <T>(work: Promise<T>) => (pending ? Promise.race([work, limit]) : work),
    cancel,
    finish() {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
    },
  };
}
