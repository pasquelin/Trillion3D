import { CARD_SURFACE } from './UI.jsx';

/** Content disclosure shares the same surface as Card and Section. */
export function Accordion({ title, children, ...props }) {
  return (
    <details className={`${CARD_SURFACE} collapse collapse-arrow`} {...props}>
      <summary className="collapse-title text-sm font-semibold">{title}</summary>
      <div className="collapse-content">{children}</div>
    </details>
  );
}
