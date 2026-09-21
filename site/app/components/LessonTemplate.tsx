import type { ReactNode } from 'react';

interface LessonTemplateProps {
  /** The lesson this page shows, published as `data-lesson` for tests and browser proofs. */
  id: string;
  /** Page heading: what the lesson is called and, under it, what it shows. */
  title: ReactNode;
  description?: ReactNode;
  /** The API names the lesson calls, shown beside the title. */
  badges?: ReactNode;
  /** The lesson's control panel, always the first thing in the reading column. */
  controls?: ReactNode;
  /** Input, output, what to try, what changes. */
  cards?: ReactNode;
  /** The lesson's code, which takes the height the column has left and scrolls inside it. */
  code?: ReactNode;
  /** The render and its counters, filling the observing column. */
  viewport: ReactNode;
  /** What sits under the render: a note, a diagram, whatever the lesson adds. */
  note?: ReactNode;
}

/** The one layout every lesson uses: a header carrying its title and API badges, a reading column
 * (controls, cards, code) and an observing column (the render). It fills the content area exactly
 * — the page never scrolls, neither column scrolls, and only the code scrolls inside its own
 * panel. A lesson brings its pieces, never its own layout. */
export function LessonTemplate({
  id,
  title,
  description,
  badges,
  controls,
  cards,
  code,
  viewport,
  note,
}: LessonTemplateProps) {
  return (
    <div className="lesson-template" data-lesson={id}>
      <header className="lesson-header">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p className="text-sm text-base-content/80">{description}</p>}
        </div>
        {badges && <div className="lesson-badges">{badges}</div>}
      </header>
      <div className="lesson-columns">
        <div className="lesson-read">
          {controls}
          {cards}
          {code && <div className="lesson-code">{code}</div>}
        </div>
        <div className="lesson-observe">
          <div className="lesson-viewport">{viewport}</div>
          {note && <div className="lesson-note">{note}</div>}
        </div>
      </div>
    </div>
  );
}
