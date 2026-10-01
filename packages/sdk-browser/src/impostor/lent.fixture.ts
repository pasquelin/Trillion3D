// The impostor family's modules tested alone, outside the bundle: lent the core's pieces of both
// renderers once, as `loadImpostorCode` lends a renderer's when the family arrives (`borrowed.ts`).
// A test imports it first.
import * as webgl from '../webgl/impostor/lent.ts';
import * as webgpu from '../webgpu/impostor/lent.ts';
import { lend } from './borrowed.ts';

lend(webgl);
lend(webgpu);
