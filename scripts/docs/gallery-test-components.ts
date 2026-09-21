import { loadReactComponents } from './render-react.ts';
import type { Gallery as GalleryComponent } from '../../site/app/gallery/Gallery.tsx';
import type { Playground as PlaygroundComponent } from '../../site/app/gallery/Playground.tsx';
import type { ExampleCard as ExampleCardComponent } from '../../site/app/gallery/ExampleCard.tsx';
import type { Home as HomeComponent } from '../../site/app/portal/Home.tsx';
import type { CodeBlock as CodeBlockComponent } from '../../site/app/components/CodeBlock.tsx';

/** The gallery test's five React components, typed against their real prop signatures
 * instead of the `unknown` `loadReactComponents` returns for its esbuild-compiled module. */
export const { Gallery } = (await loadReactComponents('site/app/gallery/Gallery.tsx')) as {
  Gallery: typeof GalleryComponent;
};
export const { Playground } = (await loadReactComponents('site/app/gallery/Playground.tsx')) as {
  Playground: typeof PlaygroundComponent;
};
export const { ExampleCard } = (await loadReactComponents('site/app/gallery/ExampleCard.tsx')) as {
  ExampleCard: typeof ExampleCardComponent;
};
export const { Home } = (await loadReactComponents('site/app/portal/Home.tsx')) as {
  Home: typeof HomeComponent;
};
export const { CodeBlock } = (await loadReactComponents('site/app/components/CodeBlock.tsx')) as {
  CodeBlock: typeof CodeBlockComponent;
};
