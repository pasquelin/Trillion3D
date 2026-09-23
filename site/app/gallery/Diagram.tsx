import { useEffect, useRef } from 'react';
import { useWords } from '../i18n.ts';
import type { WebGPUCanvasProps } from './WebGPUCanvas.tsx';
import { Accordion } from '../ui/Accordion.tsx';
import { draw } from '../../lessons/draw.ts';
import { evaluate } from '../../lessons/evaluate.ts';

type DiagramProps = Pick<WebGPUCanvasProps, 'id' | 'state' | 'locale' | 'label'>;

export function Diagram({ id, state, locale, label }: DiagramProps) {
  const t = useWords(locale);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (svg.current) {
      draw(svg.current, evaluate(id, state, locale), locale);
    }
  }, [id, state, locale]);
  return (
    <Accordion title={t('gallery.diagram')}>
      <svg ref={svg} className="w-full h-auto min-h-64" role="img" aria-label={label} />
    </Accordion>
  );
}
