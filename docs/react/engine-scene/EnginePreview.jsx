import { sceneCopy } from '../../js/engine-scene/content.js';
import { sceneControlsCopy } from '../../js/engine-scene/controlsCopy.js';
import { Canvas } from '../components/Canvas.jsx';
import { Section } from '../components/Section.jsx';
import { Alert, Button, Field, Form, Range, Select, Toggle } from '../components/UI.jsx';

const MODES = ['beauty', 'clusters', 'pages', 'wireframe', 'lod', 'screen-error', 'visibility'];
export const engineCopy = (locale) => ({
  ...(sceneCopy[locale] ?? sceneCopy.en),
  ...(sceneControlsCopy[locale] ?? sceneControlsCopy.en),
});

function Toolbar({ copy, diagnostic }) {
  return (
    <Section title={copy.controls} className="mb-4">
      <Form className="flex flex-wrap items-end">
        <Button variant="primary" data-scene-start hidden>
          {copy.retry}
        </Button>
        <Field label={copy.mode}>
          <Select data-scene-mode defaultValue={diagnostic} disabled>
            {MODES.map((mode) => (
              <option value={mode} key={mode}>
                {copy[mode]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={copy.quality} className="w-36">
          <Range
            min="0"
            max="8"
            step="1"
            defaultValue="0"
            data-scene-quality
            disabled
            aria-label={copy.quality}
          />
          <output className="font-mono text-xs w-8" data-scene-quality-value>
            0 px
          </output>
        </Field>
        <Field label={copy.light} className="w-40">
          <Range
            min="0.25"
            max="2"
            step="0.05"
            defaultValue="1"
            data-scene-light
            disabled
            aria-label={copy.light}
          />
          <output className="font-mono text-xs w-12" data-scene-light-value>
            {copy.lightValue}1
          </output>
        </Field>
        <Field label={copy.shadows}>
          <Toggle data-scene-shadows defaultChecked disabled aria-label={copy.shadows} />
        </Field>
        <div className="join">
          <Button
            size="sm"
            className="join-item"
            data-scene-zoom-out
            disabled
            aria-label={copy.zoomOut}
          >
            −
          </Button>
          <Button
            size="sm"
            className="join-item"
            data-scene-zoom-in
            disabled
            aria-label={copy.zoomIn}
          >
            +
          </Button>
        </div>
        <Button data-scene-home disabled>
          {copy.home}
        </Button>
      </Form>
    </Section>
  );
}

export function EnginePreview({ locale = 'en', diagnostic = 'beauty' }) {
  const copy = engineCopy(locale);
  return (
    <section data-engine-scene className="engine-preview min-w-0">
      <Toolbar copy={copy} diagnostic={diagnostic} />
      <div className="engine-canvas-frame relative rounded-2xl overflow-hidden border border-base-300 bg-[#101b2b] max-w-5xl mx-auto">
        <Canvas data-scene-canvas className="aspect-video max-h-[28rem]" label={copy.title} />
        <div
          data-scene-placeholder
          className="absolute inset-0 bg-[#101b2b] text-white overflow-hidden"
        >
          <img
            src="./assets/kinetic-garden/preview.png"
            alt={copy.previewAlt}
            className="w-full h-full object-cover"
          />
          <Alert className="absolute inset-x-0 bottom-0 rounded-none">
            <span className="loading loading-spinner loading-sm" />
            <span data-scene-placeholder-status>{copy.loading}</span>
          </Alert>
        </div>
      </div>
      <p data-scene-status role="status" className="my-3 text-sm">
        {copy.loading}
      </p>
    </section>
  );
}
