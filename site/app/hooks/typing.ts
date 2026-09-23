/** Whether the focus is in a place that takes typed keys: a field, a list or an editor. */
export const typing = () => {
  const focused = document.activeElement;
  return (
    /INPUT|TEXTAREA|SELECT/.test(focused?.tagName ?? '') ||
    (focused instanceof HTMLElement && focused.isContentEditable)
  );
};
