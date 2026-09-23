import { useWords } from '../i18n.ts';
import { Alert } from '../ui/Alert.tsx';
import { Collapse } from '../ui/Collapse.tsx';
import { reportCopy } from '../../reports/copy.ts';
import type { Locale } from '../../content/locale.ts';

interface SceneNoticeProps {
  note?: string | null;
  locale: Locale;
}

/** Preserve campaign-supplied scene limitations, including the original source wording. */
export function SceneNotice({ note, locale }: SceneNoticeProps) {
  const t = useWords(locale);
  if (!note) return null;
  return (
    <Alert tone="warning" className="grid-cols-1">
      <div className="grid w-full grid-cols-1 gap-2 min-w-0">
        <p>
          {note.includes('export omitted')
            ? reportCopy(locale).sourceTextures
            : t('report.sceneLimit')}
        </p>
        <Collapse title={t('report.originalNote')}>
          <p>{note}</p>
        </Collapse>
      </div>
    </Alert>
  );
}
