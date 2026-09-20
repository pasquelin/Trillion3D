/** Presentation only: preserve the original numeric state and calculation precision. */
export function formatNumericText(text) {
  return String(text).replace(/-?\d+\.\d+(?:e[+-]?\d+)?/gi, (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? String(Number(number.toFixed(3))) : value;
  });
}
