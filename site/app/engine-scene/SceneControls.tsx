import type { DiagnosticMode } from '../../lessons/engine-scene/diagnosticModes.ts';
import type { EngineCopy } from '../../lessons/engine-scene/content.ts';
import { ControlActions, ControlLabel, ControlPanel } from '../components/ControlPanel.tsx';
import { Button, Field, Range, Select, Toggle } from '../components/UI.tsx';
import { DIAGNOSTIC_MODES } from '../../lessons/engine-scene/diagnosticModes.ts';

interface SceneControlsProps {
  copy: EngineCopy;
  diagnostic: DiagnosticMode;
}

export function SceneControls({ copy, diagnostic }: SceneControlsProps) {
  return (
    <ControlPanel aria-label={copy.controls} className="scene-controls mb-4">
      <ControlActions>
        <Button variant="primary" data-scene-start hidden>
          {copy.retry}
        </Button>
      </ControlActions>
      <Field label={copy.mode}>
        <div className="scene-control-slot">
          <Select data-scene-mode defaultValue={diagnostic} disabled>
            {DIAGNOSTIC_MODES.map((mode) => (
              <option value={mode} key={mode}>
                {copy[mode]}
              </option>
            ))}
          </Select>
        </div>
      </Field>
      <Field
        label={
          <ControlLabel
            label={copy.quality}
            value={<output data-scene-quality-value>0 px</output>}
          />
        }
      >
        <div className="scene-control-slot">
          <Range
            min="0"
            max="8"
            step="1"
            defaultValue="0"
            data-scene-quality
            disabled
            aria-label={copy.quality}
          />
        </div>
      </Field>
      <Field
        label={
          <ControlLabel
            label={copy.light}
            value={<output data-scene-light-value>{copy.lightValue}1</output>}
          />
        }
      >
        <div className="scene-control-slot">
          <Range
            min="0.25"
            max="2"
            step="0.05"
            defaultValue="1"
            data-scene-light
            disabled
            aria-label={copy.light}
          />
        </div>
      </Field>
      <Field label={copy.shadows}>
        <div className="scene-control-slot">
          <Toggle data-scene-shadows defaultChecked disabled aria-label={copy.shadows} />
        </div>
      </Field>
    </ControlPanel>
  );
}
