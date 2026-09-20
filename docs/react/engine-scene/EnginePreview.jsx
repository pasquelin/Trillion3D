import { sceneCopy } from '../../js/engine-scene/content.js';
import { sceneControlsCopy } from '../../js/engine-scene/controlsCopy.js';
import { Canvas } from '../components/Canvas.jsx';
import { SceneControls } from './SceneControls.jsx';
import { Loading } from '../components/Loading.jsx';
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
        className="engine-canvas-frame relative aspect-video max-h-[28rem] rounded-2xl overflow-hidden border border-base-300 max-w-5xl mx-auto"
        style={{ backgroundColor: SCENE_BACKGROUND.css }}
      >
        <Canvas
          data-scene-canvas
          className="absolute inset-0 h-full"
          label={copy.title}
          actions={[
            { label: copy.zoomOut, symbol: '−', 'data-scene-zoom-out': '', disabled: true },
            { label: copy.zoomIn, symbol: '+', 'data-scene-zoom-in': '', disabled: true },
            { label: copy.home, symbol: '↺', 'data-scene-home': '', disabled: true },
          ]}
        />
        <Loading data-scene-loading label={copy.loading} />
      </div>
      <p data-scene-status role="status" className="my-3 text-sm" />
    </section>
  );
}
