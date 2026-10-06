// The WebGL2 renderer's code, a family on demand (`../../host/families.ts`, #1353): the autonomous
// page path, one module so that the CDN bundle makes one chunk of it, which a page drawing with
// WebGPU never downloads.
export { autonomousPagesBackend as rendererBackend } from './pages.ts'
