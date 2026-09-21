import type { PortalEntry } from '../model.ts';

/** Constants and enums of the image and its quality, each read from the file named in `module`. */
const ENUM = { section: 'enums', kind: 'Type' };
const CONST = { section: 'enums', kind: 'Constant' };

export const ENUMS_IMAGE: PortalEntry[] = [
  {
    ...CONST,
    id: 'IDENTITY_MATRIX4',
    exports: ['IDENTITY_MATRIX4'],
    module: 'packages/sdk-core/mathMatrix4.ts',
    signature: 'const IDENTITY_MATRIX4: Float64Array',
    description:
      'Column-major identity, read and never written: the pose of a node or of a root with no pose.',
    values: [
      { name: '[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]', desc: 'Sixteen numbers, column-major.' },
    ],
    replaces: 'Matrix4.identity()',
    example: `import { IDENTITY_MATRIX4, copyMatrix4 } from 'web-geometry';

copyMatrix4(nodeTransform, IDENTITY_MATRIX4); // reset, no allocation`,
  },
  {
    ...ENUM,
    id: 'DiagnosticMode',
    exports: ['DiagnosticMode', 'DIAGNOSTICS'],
    module: 'packages/sdk-core/diagnostics.ts',
    signature:
      "type DiagnosticMode = 'beauty' | 'wireframe' | 'clusters' | 'lod' | 'screen-error' | 'materials' | 'visibility' | 'pages' | 'texture-mip' | 'overdraw'",
    description:
      'What a frame draws. Availability describes real pipeline outputs, never synthetic overlays: `DIAGNOSTICS` gives, per mode, whether the backend can produce it and why not.',
    values: [
      { name: "'beauty'", desc: 'The lit image, from the glTF materials.' },
      {
        name: "'wireframe'",
        desc: 'A filled unique colour per submitted triangle — not GL_LINES, not `MeshBasicMaterial.wireframe`.',
      },
      {
        name: "'clusters'",
        desc: 'Stable primitive/page identity, one colour per cluster; exact-cluster backend only.',
      },
      {
        name: "'lod'",
        desc: 'Level-0 clusters against the coarser DAG reductions actually selected this frame.',
      },
      {
        name: "'screen-error'",
        desc: 'The per-cluster error projected through the cluster sphere, as the cut uses it.',
      },
      {
        name: "'materials'",
        desc: 'One colour per material class: the class pass that resolved the pixel. WebGPU visibility path only.',
      },
      {
        name: "'visibility'",
        desc: 'Selected visible pages; rejected hierarchy nodes are counted, not drawn.',
      },
      {
        name: "'pages'",
        desc: 'Attached index pages; missing pages are not drawn. Not physical VRAM.',
      },
      { name: "'texture-mip'", desc: 'Unavailable: texture mip residency is not instrumented.' },
      { name: "'overdraw'", desc: 'Unavailable: no fragment counter.' },
    ],
    example: `import { DIAGNOSTICS } from 'web-geometry';

explorer.setDiagnostic('clusters');
console.log(DIAGNOSTICS['overdraw']); // { available: false, reason: 'No fragment counter' }`,
  },
  {
    ...ENUM,
    id: 'LodQualityId',
    exports: ['LodQualityId', 'LOD_QUALITY', 'lodQuality', 'adaptivePixelError'],
    module: 'packages/sdk-core/lodPolicy.ts',
    signature:
      "type LodQualityId = 'source' | 'high' | 'balanced' | 'adaptive'\nconst LOD_QUALITY: Record<LodQualityId, { id, label, pixelError, anisotropy, adaptive }>",
    description:
      'Runtime LOD presets. `pixelError` is the screen-space threshold the exact-cluster selection consumes; `0` keeps the exact leaves.',
    values: [
      { name: "'source'", desc: 'Maximum source detail — `pixelError: 0`, source anisotropy.' },
      { name: "'high'", desc: 'High quality — `pixelError: 1`, maximum anisotropy.' },
      { name: "'balanced'", desc: 'Balanced — `pixelError: 4`.' },
      {
        name: "'adaptive'",
        desc: 'Adaptive — `pixelError: 2`, raised with camera speed by `adaptivePixelError(base, speed, radius)`; a still view keeps the base.',
      },
    ],
    example: `import { LOD_QUALITY, lodQuality } from 'web-geometry';

const { pixelError } = lodQuality('balanced'); // 4; an unknown id throws
explorer.setPixelError(pixelError);`,
  },
  {
    ...ENUM,
    id: 'ScreenErrorVariant',
    exports: ['ScreenErrorVariant', 'setScreenErrorVariant', 'screenErrorVariant'],
    module: 'packages/sdk-core/screenErrorVariant.ts',
    signature: "type ScreenErrorVariant = 'certifiee' | 'reference'",
    description:
      'Which projection of the cluster error the cut compares to the threshold. Module state for the whole page, read by the CPU metric and inlined into the selection shader when it is compiled; each side of a bench runs in its own page. Public source of the formula: Karis, Stubbe and Wihlidal, SIGGRAPH 2021, "Advances in Real-Time Rendering in Games".',
    values: [
      {
        name: "'certifiee'",
        desc: 'Ours (the default): a bound that never under-estimates the error.',
      },
      { name: "'reference'", desc: 'The published formula, for the comparison bench.' },
    ],
    example: `import { screenErrorVariant, setScreenErrorVariant } from 'web-geometry';

setScreenErrorVariant('reference'); // null or undefined restores 'certifiee'
console.log(screenErrorVariant());`,
  },
];
