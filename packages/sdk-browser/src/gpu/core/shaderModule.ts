/**
 * Compilation errors of a shader module. A device that cannot report these messages proves no
 * error: the list is then empty, and the caller keeps the path it would have kept.
 */
export async function shaderErrors(module: GPUShaderModule) {
  const info = await module.getCompilationInfo?.()
  return info ? info.messages.filter((message) => message.type === 'error') : []
}

/**
 * A module whose compilation is checked before the first pipeline: an error always carries the
 * name of the shader that produced it rather than an anonymous stack.
 */
export const createCheckedShaderModule = (device: GPUDevice, code: string, label: string) =>
  checkShaderModule(device.createShaderModule({ label, code }), label)

/** `module`, once its compilation is checked: an error carries `label`. For a module made at once
 *  and shared by pipelines asked before the check settles. */
export async function checkShaderModule(module: GPUShaderModule, label: string) {
  const errors = await shaderErrors(module)
  if (errors.length) throw new Error(`${label}: ${errors.map((error) => error.message).join('\n')}`)
  return module
}

/** True when the module failed to compile: the caller returns its fallback. */
export async function shaderFailed(module: GPUShaderModule) {
  return (await shaderErrors(module)).length > 0
}
