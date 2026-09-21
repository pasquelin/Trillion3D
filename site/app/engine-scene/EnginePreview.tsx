import type { Locale } from '../../content/locale.ts';
import type { DiagnosticMode, EngineCopy } from '../types/engine-scene.ts';
import { sceneCopy } from '../../lessons/engine-scene/content.ts';
import { sceneControlsCopy } from '../../lessons/engine-scene/controlsCopy.ts';
import { Canvas } from '../components/Canvas.tsx';
import { SceneControls } from './SceneControls.tsx';
import { Loading } from '../components/Loading.tsx';
import { SCENE_BACKGROUND } from '../../lessons/scenePalette.ts';

export const engineCopy = (locale: Locale): EngineCopy => ({
  ...(sceneCopy[locale] ?? sceneCopy.en),
  ...(sceneControlsCopy[locale] ?? sceneControlsCopy.en),
});

export function EnginePreview({
  locale = 'en',
  diagnostic = 'beauty',
}: {
  locale?: Locale;
  diagnostic?: DiagnosticMode;
}) {
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
