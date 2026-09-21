import type { DIAGNOSTIC_MODES } from '../../js/engine-scene/diagnosticModes.js';
import type { DiagnosticMode as EngineDiagnosticMode } from '../../../packages/sdk/index.ts';
import type { sceneCopy } from '../../js/engine-scene/content.js';
import type { sceneControlsCopy } from '../../js/engine-scene/controlsCopy.js';

type OfferedByEngine<Mode extends EngineDiagnosticMode> = Mode;

/** The documented modes, each one a mode the engine offers: a typo in the JS list fails here. */
export type DiagnosticMode = OfferedByEngine<(typeof DIAGNOSTIC_MODES)[number]>;

export type EngineCopy = typeof sceneCopy.en & typeof sceneControlsCopy.en;
