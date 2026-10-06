// The WebGPU renderer's code, a family on demand (`../../host/families.ts`): the page
// raster and every pass it draws with, one module so that the CDN bundle makes one chunk of it,
// which a page drawing with WebGL2 never downloads.
export { webgpuPagesBackend as rendererBackend } from './pages.ts'
