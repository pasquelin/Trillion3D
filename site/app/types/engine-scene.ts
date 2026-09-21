import type { DIAGNOSTIC_MODES } from '../../lessons/engine-scene/diagnosticModes.ts';
import type { DiagnosticMode as EngineDiagnosticMode } from '../../../packages/sdk/index.ts';
import type { sceneCopy } from '../../lessons/engine-scene/content.ts';
import type { sceneControlsCopy } from '../../lessons/engine-scene/controlsCopy.ts';

type OfferedByEngine<Mode extends EngineDiagnosticMode> = Mode;

/** The documented modes, each one a mode the engine offers: a typo in the JS list fails here. */
export type DiagnosticMode = OfferedByEngine<(typeof DIAGNOSTIC_MODES)[number]>;

export type EngineCopy = typeof sceneCopy.en & typeof sceneControlsCopy.en;
