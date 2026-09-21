import type { Locale } from '../../content/locale.ts';
import type { EngineCopy } from '../../lessons/engine-scene/content.ts';
import { sceneCopy } from '../../lessons/engine-scene/content.ts';
import { sceneControlsCopy } from '../../lessons/engine-scene/controlsCopy.ts';
import { Canvas } from '../components/Canvas.tsx';
import { Loading } from '../components/Loading.tsx';
import { SCENE_BACKGROUND } from '../../lessons/scenePalette.ts';

export const engineCopy = (locale: Locale): EngineCopy => ({
  ...(sceneCopy[locale] ?? sceneCopy.en),
  ...(sceneControlsCopy[locale] ?? sceneControlsCopy.en),
});

/** The engine scene's render, framed and sized by the lesson template like any other viewport. */
export function EnginePreview({ locale = 'en' }: { locale?: Locale }) {
  const copy = engineCopy(locale);
  return (
    <section data-engine-scene className="geometry-3d-viewport flex flex-col gap-2 min-w-0">
      <Canvas
        data-scene-canvas
        className="geometry-3d-canvas"
        style={{ backgroundColor: SCENE_BACKGROUND.css }}
        label={copy.title}
        actions={[
          { label: copy.zoomOut, symbol: '−', 'data-scene-zoom-out': '', disabled: true },
          { label: copy.zoomIn, symbol: '+', 'data-scene-zoom-in': '', disabled: true },
          { label: copy.home, symbol: '↺', 'data-scene-home': '', disabled: true },
        ]}
      />
      <Loading data-scene-loading label={copy.loading} />
      <p data-scene-status role="status" className="text-sm" />
    </section>
  );
}
