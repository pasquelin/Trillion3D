import type * as THREE from 'three';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { ComparisonLayout } from './comparison.ts';

export type ExplorerApiState = {
  active: RenderBackend;
  fallbackReason: string | null;
  diagnostic: DiagnosticMode;
  comparisonLayout: ComparisonLayout;
  comparisonPair: [string, string];
  wipe: number;
  toggle: 0 | 1;
  disposed: boolean;
  measurementTarget?: THREE.WebGLRenderTarget;
  pairTargetA?: THREE.WebGLRenderTarget;
  pairTargetB?: THREE.WebGLRenderTarget;
};
