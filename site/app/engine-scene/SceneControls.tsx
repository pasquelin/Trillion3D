import type { DiagnosticMode } from '../../lessons/engine-scene/diagnosticModes.ts';
import type { EngineCopy } from '../../lessons/engine-scene/content.ts';
import { LessonControls } from '../components/LessonControls.tsx';
import { Button } from '../components/UI.tsx';
import { DIAGNOSTIC_MODES } from '../../lessons/engine-scene/diagnosticModes.ts';

interface SceneControlsProps {
  copy: EngineCopy;
  diagnostic: DiagnosticMode;
}

/** The engine scene's controls, described like every other lesson's; the scene script drives them
 * through their data attributes once the explorer is up. */
export function SceneControls({ copy, diagnostic }: SceneControlsProps) {
  return (
    <LessonControls
      controls={[
        {
          kind: 'select',
          id: 'mode',
          label: copy.mode,
          defaultValue: diagnostic,
          options: DIAGNOSTIC_MODES.map((mode) => ({ value: mode, label: copy[mode] })),
          props: { 'data-scene-mode': '', disabled: true },
        },
        {
          kind: 'range',
          id: 'quality',
          label: copy.quality,
          display: <output data-scene-quality-value>0 px</output>,
          min: 0,
          max: 8,
          step: 1,
          defaultValue: 0,
          props: { 'data-scene-quality': '', disabled: true },
        },
        {
          kind: 'range',
          id: 'light',
          label: copy.light,
          display: <output data-scene-light-value>{copy.lightValue}1</output>,
          min: 0.25,
          max: 2,
          step: 0.05,
          defaultValue: 1,
          props: { 'data-scene-light': '', disabled: true },
        },
        {
          kind: 'toggle',
          id: 'shadows',
          label: copy.shadows,
          defaultChecked: true,
          props: { 'data-scene-shadows': '', disabled: true },
        },
      ]}
      actions={
        <Button variant="primary" data-scene-start hidden>
          {copy.retry}
        </Button>
      }
    />
  );
}
