import type { Locale } from '../../content/locale.ts';
import { CodeBlock } from './CodeBlock.tsx';
import { RenderFrame } from './RenderFrame.tsx';
import { scriptPage, srcdocFor } from './srcdoc.ts';

interface LiveCodeProps {
  /** A module script drawing on `<canvas id="view">`. */
  code: string;
  /** Where the script's relative imports resolve from, as if it were that file. */
  from: string;
  label: string;
  locale: Locale;
}

/** A short script beside what it draws: the very code shown is what runs in the frame. */
export function LiveCode({ code, from, label, locale }: LiveCodeProps) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      <CodeBlock code={code} locale={locale} label={label} />
      <RenderFrame>
        <iframe srcDoc={srcdocFor(scriptPage(code), from)} title={label} />
      </RenderFrame>
    </div>
  );
}
