/** Something the engine tells about itself while it runs: a change it made, or a failure. */
export type RuntimeEvent =
  | {
      eventVersion: 1;
      type: 'capability' | 'optimization' | 'fallback';
      audience: 'diagnostic';
      recovered: true;
      code: string;
      detail?: string;
    }
  | {
      eventVersion: 1;
      type: 'fatal';
      audience: 'blocking';
      recovered: false;
      code: string;
      detail?: string;
    };
/** A message for the person using the page, with what they can do. */
export interface UserNotice {
  /** Which message. */
  messageKey: 'scene-unavailable';
  /** What they can do. */
  action: 'retry';
}
/** Backend names and recovered error details never become ordinary product UI. */
export function userNotice(event: RuntimeEvent): UserNotice | null {
  return event.type === 'fatal' && event.audience === 'blocking' && !event.recovered
    ? { messageKey: 'scene-unavailable', action: 'retry' }
    : null;
}
