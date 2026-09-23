// The public surface the documentation runs: the common facade's maths, the diagnostic, quality
// and format tables the enum pages show, and the internal browser depth convention the portal
// explains without presenting it as an application import. The demos import this module; the
// site build bundles it as `js/engine.js`, the module the code editor's snippets import, so every
// demo and every edited snippet executes the engine itself rather than a copy of it.
export * from '../../packages/sdk/common/math.ts';
export { DIAGNOSTICS } from '../../packages/sdk/common/diagnostics.ts';
export {
  LOD_QUALITY,
  adaptivePixelError,
  lodQuality,
} from '../../packages/sdk/common/contracts.ts';
export { COLUMN_KIND } from '../../packages/sdk/common/streaming.ts';
export {
  DEPTH_CLEAR,
  DEPTH_COMPARE_OR_EQUAL,
  DEPTH_NEAR,
} from '../../packages/sdk-browser/src/camera/depthConvention.ts';
