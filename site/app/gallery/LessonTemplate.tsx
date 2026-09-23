import type { ReactNode } from 'react';
import { DocPage } from '../layout/DocPage.tsx';
import { Split } from '../ui/Split.tsx';

interface LessonTemplateProps {
  /** The lesson this page shows, published as `data-lesson` for tests and browser proofs. */
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** The API names the lesson calls, shown under the title. */
  badges?: ReactNode;
  /** The lesson's control panel, always the first thing in the reading column. */
  controls?: ReactNode;
  /** Input, output, what to try, what changes. */
  cards?: ReactNode;
  /** The lesson's code, which scrolls inside its own panel. */
  code?: ReactNode;
  /** The render and its counters, at the top of the observing column. */
  viewport: ReactNode;
  /** What sits under the render: a note, a diagram, whatever the lesson adds. */
  note?: ReactNode;
}

/** A lesson on the reading page: its title, description and API badges, then a reading column
 * (controls, cards, code) beside an observing column (the render, then its note). */
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
    <DocPage data-lesson={id} title={title} lead={description} actions={badges}>
      <Split
        read={
          <>
            {controls}
            {cards}
            {code}
          </>
        }
        observe={
          <>
            {viewport}
            {note}
          </>
        }
      />
    </DocPage>
  );
}
