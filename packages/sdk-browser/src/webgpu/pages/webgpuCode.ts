// The renderer's code, a family on demand (`../../host/families.ts`, #1353): the page raster and
// every pass it draws with, one module so that the CDN bundle makes one chunk of it, downloaded
// once a page draws.
export { webgpuPagesEngine as createEngine } from './pages.ts'
