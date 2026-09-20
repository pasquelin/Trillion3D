import React, { useEffect, useRef } from 'react';
import { Accordion } from '../components/Accordion.jsx';
import { draw } from '../../js/gallery/draw.js';
import { evaluate } from '../../js/gallery/evaluate.js';

export function Diagram({ id, state, locale, label }) {
  const svg = useRef(null);
  useEffect(() => draw(svg.current, evaluate(id, state, locale), locale), [id, state, locale]);
  return (
    <Accordion title={locale === 'fr' ? 'Schéma 2D complémentaire' : 'Complementary 2D diagram'}>
      <svg ref={svg} className="w-full h-auto min-h-64" role="img" aria-label={label} />
    </Accordion>
  );
}
