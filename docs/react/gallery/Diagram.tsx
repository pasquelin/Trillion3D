import { useEffect, useRef } from 'react';
import type { WebGPUCanvasProps } from '../types/gallery.ts';
import { Accordion } from '../components/Accordion.tsx';
import { draw } from '../../js/gallery/draw.js';
import { evaluate } from '../../js/gallery/evaluate.js';

type DiagramProps = Pick<WebGPUCanvasProps, 'id' | 'state' | 'locale' | 'label'>;

export function Diagram({ id, state, locale, label }: DiagramProps) {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (svg.current) {
      draw(svg.current, evaluate(id, state, locale), locale);
    }
  }, [id, state, locale]);
  return (
    <Accordion title={locale === 'fr' ? 'Schéma 2D complémentaire' : 'Complementary 2D diagram'}>
      <svg ref={svg} className="w-full h-auto min-h-64" role="img" aria-label={label} />
    </Accordion>
  );
}
