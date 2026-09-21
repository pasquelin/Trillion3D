import { routeHref } from './routes.ts';
import type { RouteArea } from './routes.ts';
import { examples } from '../../content/catalog.ts';
import type { CatalogExample } from '../../content/catalog.ts';
import { SectionHeader } from '../components/SectionHeader.tsx';
import { ExampleCard } from '../gallery/ExampleCard.tsx';
import type { Locale } from '../../content/locale.ts';
import type { TranslateFn } from '../../content/i18n/index.ts';

const FEATURED = ['compose-transform', 'perspective', 'lod-budget']
  .map((id) => examples.find((example) => example.id === id))
  .filter((example): example is CatalogExample => example !== undefined);

function HeroArt({ locale }: { locale: Locale }) {
  return (
    <svg
      className="hero-art"
      viewBox="0 0 560 470"
      role="img"
      aria-label={
        locale === 'fr' ? 'Paysage géométrique composé de grappes' : 'Clustered geometric landscape'
      }
    >
      <defs>
        <linearGradient id="hero-fill" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#2dd4bf" stopOpacity=".28" />
          <stop offset="1" stopColor="#6366f1" stopOpacity=".08" />
        </linearGradient>
      </defs>
      <g fill="url(#hero-fill)" stroke="currentColor" strokeWidth="1.2">
        <path d="M70 345 175 92l92 151 78-202 142 304-210 82Z" />
        <path d="m70 345 197-102 10 184m-102-335 102 335M345 41l-78 202 220 102M175 92l170-51m-78 202 78-202m-170 51L70 345m197-102 220 102M70 345l207 82m68-386 142 304" />
      </g>
      <g fill="currentColor">
        {[
          [70, 345],
          [175, 92],
          [267, 243],
          [345, 41],
          [487, 345],
          [277, 427],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" />
        ))}
      </g>
      <g className="hero-clusters">
        <path d="m179 102 78 135-76 39-50-68Z" />
        <path d="m274 246 68-188 70 150-66 52Z" />
        <path d="m280 253 61 13 125 73-179 76Z" />
      </g>
    </svg>
  );
}

export function Home({ locale, t }: { locale: Locale; t: TranslateFn }) {
  const fr = locale === 'fr';
  const steps: [string, RouteArea][] = [
    ['quick-start', 'learn'],
    ['architecture', 'learn'],
    ['example-diagnostics', 'learn'],
  ];
  return (
    <>
      <section className="home-hero">
        <div>
          <p className="eyebrow">{t(locale, 'home.eyebrow')}</p>
          <h1>{t(locale, 'home.title')}</h1>
          <p className="hero-copy">{t(locale, 'home.description')}</p>
          <div className="hero-actions">
            <a
              className="btn btn-primary"
              href={routeHref({ locale, area: 'learn', id: 'quick-start' })}
            >
              {t(locale, 'home.start')} <span>→</span>
            </a>
            <a className="btn btn-ghost" href={routeHref({ locale, area: 'api', id: '' })}>
              {t(locale, 'home.explore')}
            </a>
          </div>
        </div>
        <HeroArt locale={locale} />
      </section>
      <section className="featured">
        <SectionHeader
          eyebrow={`01 — ${t(locale, 'nav.lessons')}`}
          title={fr ? 'Voir les calculs' : 'See the maths move'}
          description={
            fr
              ? 'Manipulez les mêmes fonctions que le moteur utilise, avec leurs entrées et résultats visibles.'
              : 'Manipulate the same functions the engine uses, with their inputs and results in view.'
          }
        />
        <div className="featured-grid">
          {FEATURED.map((example) => (
            <ExampleCard key={example.id} example={example} locale={locale} />
          ))}
        </div>
      </section>
      <section className="learning-path">
        <div>
          <p className="section-kicker">02 — {t(locale, 'nav.learn')}</p>
          <h2>{t(locale, 'home.pathTitle')}</h2>
          <p>{t(locale, 'home.pathDescription')}</p>
        </div>
        <ol>
          {steps.map(([id, area], index) => (
            <li key={id}>
              <span>{index + 1}</span>
              <a href={routeHref({ locale, area, id })}>
                <h3>{t(locale, `home.step${index + 1}Title`)}</h3>
                <p>{t(locale, `home.step${index + 1}Description`)}</p>
              </a>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
