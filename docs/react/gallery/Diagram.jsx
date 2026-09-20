import React, { useEffect, useRef } from 'react';
import { draw } from '../../js/gallery/draw.js';
import { evaluate } from '../../js/gallery/evaluate.js';

export function Diagram({ id, state, locale, label }) {
  const svg = useRef(null);
  useEffect(() => draw(svg.current, evaluate(id, state, locale), locale), [id, state, locale]);
  return (
    <details className="collapse collapse-arrow border border-base-300 bg-base-100">
      <summary className="collapse-title text-sm font-semibold">
        {locale === 'fr' ? 'Schéma 2D complémentaire' : 'Complementary 2D diagram'}
      </summary>
      <div className="collapse-content">
        <svg ref={svg} className="w-full h-auto min-h-64" role="img" aria-label={label} />
      </div>
    </details>
  );
}
