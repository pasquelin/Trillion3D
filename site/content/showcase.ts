// The two scenes the gallery opens on: editorial content, next to the entries it sits with.
import type { Localized } from './locale.ts';

interface ShowcaseScene {
  id: string;
  preview: string;
  title: Localized;
  description: Localized;
  action: Localized;
  alt: Localized;
}

export const showcaseScenes: ShowcaseScene[] = [
  {
    id: 'runtime-pixel-error',
    preview: './assets/gallery/renderer/runtime-pixel-error.png',
    title: { en: 'Cross the observatory', fr: 'Traverser l’observatoire' },
    description: {
      en: 'Explore 91,352 authored triangles, then reveal where the streamed cut becomes coarser.',
      fr: 'Explorez 91 352 triangles originaux, puis affichez où la géométrie streamée se simplifie.',
    },
    action: { en: 'Explore live LOD', fr: 'Explorer le LOD en direct' },
    alt: {
      en: 'Sunlit observatory with fluted colonnades, copper dome and brass armillary',
      fr: 'Observatoire éclairé avec colonnades cannelées, dôme de cuivre et sphère armillaire',
    },
  },
  {
    id: 'shadow-casting-switch',
    preview: './assets/gallery/renderer/shadow-casting-switch.png',
    title: { en: 'Direct the shadow theatre', fr: 'Diriger le théâtre d’ombres' },
    description: {
      en: 'Switch the key light shadow while three distinct puppets and the theatre stay lit.',
      fr: 'Coupez l’ombre de la lumière principale tout en gardant les trois marionnettes éclairées.',
    },
    action: { en: 'Try the shadow switch', fr: 'Essayer l’interrupteur d’ombre' },
    alt: {
      en: 'Velvet puppet theatre with a bird, fox and leafy branch casting shadows',
      fr: 'Théâtre de velours où un oiseau, un renard et une branche projettent leurs ombres',
    },
  },
];
