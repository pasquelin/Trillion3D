export const syncRendererState = (runtime, initial, latest) =>
  initial === latest ? Promise.resolve() : runtime.update(latest);
