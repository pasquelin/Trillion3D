import { Card } from '../components/UI.jsx';
import { routeHref } from '../../js/portal/routes.js';
import { GeometryPreview } from './WebGPUCanvas.jsx';

const categories = {
  transforms: { en: 'Transforms', fr: 'Transformations' },
  camera: { en: 'Camera', fr: 'Caméra' },
  vectors: { en: 'Vectors', fr: 'Vecteurs' },
  bounds: { en: 'Bounds', fr: 'Volumes' },
  scene: { en: 'Scene', fr: 'Scène' },
  color: { en: 'Color', fr: 'Couleur' },
  streaming: { en: 'Streaming', fr: 'Streaming' },
};
const local = (value, locale) => value[locale === 'fr' ? 'fr' : 'en'];

export const engineExample = {
  id: 'engine-scene',
  category: 'streaming',
  engine: true,
  functions: ['WebGPU', 'LOD', 'streaming'],
  title: { en: 'Live streamed geometry', fr: 'Géométrie streamée en direct' },
  description: {
    en: 'Actual streaming and LOD pipeline.',
    fr: 'Pipeline réel de streaming et LOD.',
  },
};

export function ExampleCard({ example, locale = 'en' }) {
  const title = local(example.title, locale);
  const href = routeHref({
    locale,
    area: example.engine ? 'examples' : 'playground',
    id: example.id,
  });
  const preview = example.engine ? (
    <img
      className="h-full w-full object-cover"
      src="./assets/kinetic-garden/preview.png"
      alt={
        locale === 'fr'
          ? 'Jardin géométrique rendu par WebGPU'
          : 'Geometry garden rendered by WebGPU'
      }
    />
  ) : (
    <GeometryPreview id={example.id} locale={locale} interactive={false} label={`${title} — 3D`} />
  );
  return (
    <a
      className="block h-full rounded-box focus-visible:outline-2 focus-visible:outline-primary"
      href={href}
    >
      <Card className="h-full shadow-sm overflow-hidden">
        <div className="gallery-preview rounded-box overflow-hidden bg-base-300">{preview}</div>
        <span className="badge badge-soft badge-primary">
          {example.engine
            ? locale === 'fr'
              ? 'Scène moteur'
              : 'Engine scene'
            : local(categories[example.category], locale)}
        </span>
        <h2 className="card-title text-lg">{title}</h2>
        <p className="text-sm opacity-75 grow">{local(example.description, locale)}</p>
        <span className="self-end text-primary text-xl" aria-hidden="true">
          →
        </span>
      </Card>
    </a>
  );
}
