// The two scenes the gallery opens on: editorial content, next to the entries it sits with; their
// words are each language's `showcase`.
import { localized } from './i18n/dictionary.ts';
import type { Dictionary } from './i18n/languages.inline.ts';
import type { Localized } from './locale.ts';

interface ShowcaseScene {
  id: string;
  preview: string;
  title: Localized;
  description: Localized;
  action: Localized;
  alt: Localized;
}

type SceneId = keyof Dictionary['showcase'];

const scene = (id: SceneId, preview: string): ShowcaseScene => ({
  id,
  preview,
  title: localized(({ showcase }) => showcase[id].title),
  description: localized(({ showcase }) => showcase[id].description),
  action: localized(({ showcase }) => showcase[id].action),
  alt: localized(({ showcase }) => showcase[id].alt),
});

export const showcaseScenes: ShowcaseScene[] = [
  scene('runtime-pixel-error', './assets/gallery/renderer/runtime-pixel-error.png'),
  scene('shadow-casting-switch', './assets/gallery/renderer/shadow-casting-switch.png'),
];
