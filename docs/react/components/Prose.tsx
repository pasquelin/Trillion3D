import type { ReactNode } from 'react';

export interface InlineProps {
  text?: string;
}

export function Inline({ text = '' }: InlineProps) {
  return String(text)
    .split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)
    .map((part, index) => {
      if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
      if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
      return part;
    });
}

export interface ProseProps {
  html: string;
}

/** Only repository-authored documentation HTML belongs here; never user input. */
export function Prose({ html }: ProseProps) {
  return <div className="wg-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

export interface TableProps {
  children: ReactNode;
}

export function Table({ children }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-zebra">{children}</table>
    </div>
  );
}
