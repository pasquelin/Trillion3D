/** Whether an element takes typed keys itself: a field, a list or an editor. */
export const takesKeys = (target: EventTarget | null) => {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(element?.tagName ?? '') || !!element?.isContentEditable;
};

/** Whether the focus is in a place that takes typed keys: a field, a list or an editor. */
export const typing = () => takesKeys(document.activeElement);
