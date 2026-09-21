// The two builders every lesson definition uses: a bilingual label and a control, a toggle when
// its range is exactly 0..1 by steps of 1.
import type { Localized } from '../content/locale.ts';
import type { RendererLessonControl } from './rendererLessonTypes.ts';

export const text = (en: string, fr: string): Localized => ({ en, fr });

export const range = (
  id: string,
  en: string,
  fr: string,
  min: number,
  max: number,
  value: number,
  step: number,
): RendererLessonControl => ({
  id,
  label: text(en, fr),
  type: min === 0 && max === 1 && step === 1 ? 'boolean' : 'range',
  min,
  max,
  value,
  step,
});
