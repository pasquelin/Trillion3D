import { Alert } from '../components/UI.tsx';
import { Collapse } from '../components/Collapse.tsx';
import { reportCopy } from '../../reports/copy.ts';
import type { Locale } from '../../content/locale.ts';

interface SceneNoticeProps {
  note?: string | null;
  locale: Locale;
}

/** Preserve campaign-supplied scene limitations, including the original source wording. */
export function SceneNotice({ note, locale }: SceneNoticeProps) {
  if (!note) return null;
  return (
    <Alert tone="warning" className="grid-cols-1">
      <div className="grid w-full gap-2 min-w-0">
        <p>
          {note.includes('export omitted')
            ? reportCopy(locale).sourceTextures
            : locale === 'fr'
              ? 'Cette scène comporte une limite documentée.'
              : 'This scene has a documented limitation.'}
        </p>
        <Collapse
          title={locale === 'fr' ? 'Note originale de la campagne' : 'Original campaign note'}
        >
          <p>{note}</p>
        </Collapse>
      </div>
    </Alert>
  );
}
