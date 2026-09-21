import type { ReactElement } from 'react';
import type { EngineGuideProps } from '../types/engine-scene.ts';
import type { Locale } from '../types/portal.ts';
import { Accordion } from '../components/Accordion.tsx';
import { Alert } from '../components/UI.tsx';

const QUALITY_HELP: Record<Locale, string> = {
  en: 'Pixel error 0 keeps exact leaves; raising it permits a coarser bounded DAG cut.',
  fr: 'Une erreur de 0 px conserve les feuilles exactes ; l’augmenter autorise une coupe du DAG plus grossière et bornée.',
};

export function EngineGuide({ copy, locale, diagnostic }: EngineGuideProps): ReactElement {
  const [what, tryThis, observe] = copy.views[diagnostic];
  return (
    <Accordion title={copy.details}>
      <p className="text-sm opacity-75 mb-3">{copy.preview}</p>
      <dl data-scene-guide className="grid gap-2 text-sm mt-4 sm:grid-cols-3">
        <div>
          <dt className="font-bold">{copy.guideWhat}</dt>
          <dd data-scene-what>{what}</dd>
        </div>
        <div>
          <dt className="font-bold">{copy.guideTry}</dt>
          <dd data-scene-try>{tryThis}</dd>
        </div>
        <div>
          <dt className="font-bold">{copy.guideObserve}</dt>
          <dd data-scene-observe>{observe}</dd>
        </div>
      </dl>
      <Alert className="my-3">
        <ul className="list-disc pl-5">
          <li>{QUALITY_HELP[locale]}</li>
          <li>{copy.taa}</li>
        </ul>
      </Alert>
      <p className="text-sm opacity-75">{copy.scope}</p>
    </Accordion>
  );
}
