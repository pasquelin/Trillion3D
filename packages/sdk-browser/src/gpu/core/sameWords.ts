/** Whether two word arrays hold the same words, in the same count. */
export const sameWords = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length &&
  Array.prototype.every.call(a, (word: number, at: number) => word === b[at])
