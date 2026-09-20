import { Button } from './UI.jsx';

/** Shared zero-based pagination with explicit accessible navigation labels. */
export function Pagination({ page, pages, onChange, locale = 'en' }) {
  if (pages <= 1) return null;
  const current = Math.max(0, Math.min(page, pages - 1));
  const french = locale === 'fr';
  return (
    <nav className="flex justify-center mt-6" aria-label="Pagination">
      <div className="join">
        <Button
          className="join-item"
          aria-label={french ? 'Page précédente' : 'Previous page'}
          disabled={current === 0}
          onClick={() => onChange(current - 1)}
        >
          ←
        </Button>
        <span className="join-item btn pointer-events-none" aria-live="polite" aria-atomic="true">
          {current + 1} / {pages}
        </span>
        <Button
          className="join-item"
          aria-label={french ? 'Page suivante' : 'Next page'}
          disabled={current === pages - 1}
          onClick={() => onChange(current + 1)}
        >
          →
        </Button>
      </div>
    </nav>
  );
}
