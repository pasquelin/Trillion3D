import { Section } from '../components/Section.jsx';
import { Button, Field, Form, Range, Select, Toggle } from '../components/UI.jsx';
import { DIAGNOSTIC_MODES } from '../../js/engine-scene/diagnosticModes.js';

export function SceneControls({ copy, diagnostic }) {
  return (
    <Section aria-label={copy.controls} className="scene-controls mb-4">
      <Form className="scene-controls-grid">
        <Button variant="primary" data-scene-start hidden>
          {copy.retry}
        </Button>
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
            <span className="flex items-center justify-between gap-2 w-full">
              <span>{copy.quality}</span>
              <output
                className="font-mono font-normal text-sm tabular-nums"
                data-scene-quality-value
              >
                0 px
              </output>
            </span>
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
            <span className="flex items-center justify-between gap-2 w-full">
              <span>{copy.light}</span>
              <output className="font-mono font-normal text-sm tabular-nums" data-scene-light-value>
                {copy.lightValue}1
              </output>
            </span>
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
      </Form>
    </Section>
  );
}
