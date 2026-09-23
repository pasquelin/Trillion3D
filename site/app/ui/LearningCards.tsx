import type { ReactNode } from 'react';
import { useWords } from '../i18n.ts';
import { Alert } from './Alert.tsx';
import type { Locale } from '../../content/locale.ts';

interface LearningCardsProps {
  input: ReactNode;
  output: ReactNode;
  attempt: ReactNode;
  changes: ReactNode;
  locale?: Locale;
}

export function LearningCards({
  input,
  output,
  attempt,
  changes,
  locale = 'en',
}: LearningCardsProps) {
  const t = useWords(locale);
  const titles = [
    t('learning.input'),
    t('learning.output'),
    t('learning.try'),
    t('learning.changes'),
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {[input, output, attempt, changes].map((content, index) => (
        <Alert key={titles[index]}>
          <div className="min-w-0 break-words">
            <div className="text-xs font-bold uppercase opacity-60">{titles[index]}</div>
            <div className="text-sm tabular-nums">{content}</div>
          </div>
        </Alert>
      ))}
    </div>
  );
}
