import { sceneCopy } from '../../js/engine-scene/content.js';
import { sceneControlsCopy } from '../../js/engine-scene/controlsCopy.js';
import { Canvas } from '../components/Canvas.jsx';
import { SceneControls } from './SceneControls.jsx';
import { Alert } from '../components/UI.jsx';
import { SCENE_BACKGROUND } from '../../js/scenePalette.js';

export const engineCopy = (locale) => ({
  ...(sceneCopy[locale] ?? sceneCopy.en),
  ...(sceneControlsCopy[locale] ?? sceneControlsCopy.en),
});

export function EnginePreview({ locale = 'en', diagnostic = 'beauty' }) {
  const copy = engineCopy(locale);
  return (
    <section data-engine-scene className="engine-preview min-w-0">
      <SceneControls copy={copy} diagnostic={diagnostic} />
      <div
        className="engine-canvas-frame relative rounded-2xl overflow-hidden border border-base-300 max-w-5xl mx-auto"
        style={{ backgroundColor: SCENE_BACKGROUND.css }}
      >
        <Canvas
          data-scene-canvas
          className="aspect-video max-h-[28rem]"
          label={copy.title}
          actions={[
            { label: copy.zoomOut, symbol: '−', 'data-scene-zoom-out': '', disabled: true },
            { label: copy.zoomIn, symbol: '+', 'data-scene-zoom-in': '', disabled: true },
            { label: copy.home, symbol: '↺', 'data-scene-home': '', disabled: true },
          ]}
        />
        <div
          data-scene-placeholder
          className="absolute inset-0 text-white overflow-hidden"
          style={{ backgroundColor: SCENE_BACKGROUND.css }}
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
