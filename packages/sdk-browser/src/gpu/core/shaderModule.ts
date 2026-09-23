import { dropValidation } from './errorScope.ts';

/**
 * Compilation errors of a shader module. A device that cannot report these messages proves no
 * error: the list is then empty, and the caller keeps the path it would have kept.
 */
export async function shaderErrors(module: GPUShaderModule) {
  const info = await module.getCompilationInfo?.();
  return info ? info.messages.filter((message) => message.type === 'error') : [];
}

/**
 * A module whose compilation is checked before the first pipeline: an error always carries the
 * name of the shader that produced it rather than an anonymous stack.
 */
export async function createCheckedShaderModule(device: GPUDevice, code: string, label: string) {
  const module = device.createShaderModule({ label, code });
  const errors = await shaderErrors(module);
  if (errors.length)
    throw new Error(`${label}: ${errors.map((error) => error.message).join('\n')}`);
  return module;
}

/**
 * True when the module failed to compile. The validation scope opened around compilation is then
 * closed here: the three paths that return a fallback each closed it the same way before
 * leaving. The caller keeps only its own cleanup.
 */
export async function shaderFailed(device: GPUDevice, module: GPUShaderModule) {
  if (!(await shaderErrors(module)).length) return false;
  await dropValidation(device);
  return true;
}
