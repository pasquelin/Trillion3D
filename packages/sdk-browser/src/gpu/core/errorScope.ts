/**
 * A device's validation scope, opened around a resource creation. Each creation path used to push
 * and pop it with its own compatibility guard; they share these three steps, and the guard is
 * written once. A device that cannot open a scope proves no error: nothing is refused on that
 * account, and the caller keeps the path it would have kept.
 */
export function openValidation(device: GPUDevice) {
  if (typeof device.pushErrorScope === 'function') device.pushErrorScope('validation');
}

/** Closes the scope and returns what the device refused since it opened, or nothing. */
export async function validationError(device: GPUDevice) {
  return typeof device.popErrorScope === 'function' ? await device.popErrorScope() : null;
}

/** Closes the scope without reading it: the fallback path is already decided. */
export async function dropValidation(device: GPUDevice) {
  await validationError(device).catch(() => {});
}
