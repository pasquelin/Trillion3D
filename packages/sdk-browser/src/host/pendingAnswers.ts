/** The answer of a worker lost: the protocol's, `ok` false, the code it refuses with. */
export const workerRefusal = <Protocol extends number, Code extends string>(
  protocol: Protocol,
  code: Code,
  id: number,
) => ({ protocol, id, ok: false as const, code, message: code })

/**
 * The answers a worker owes, by request id: each request `expect`s its own, `answer` hands a
 * worker's to the request it names, and `refuseAll` settles every one still owed with `refusal`
 * when the worker is lost.
 */
export function createPendingAnswers<A extends { id: number }>(refusal: (id: number) => A) {
  const owed = new Map<number, (answer: A) => void>()
  return {
    /** How many answers are owed. */
    get size() {
      return owed.size
    },
    expect(id: number, settle: (answer: A) => void) {
      owed.set(id, settle)
    },
    answer(answer: A) {
      const settle = owed.get(answer.id)
      owed.delete(answer.id)
      settle?.(answer)
    },
    refuseAll() {
      const lost = [...owed]
      owed.clear()
      for (const [id, settle] of lost) settle(refusal(id))
    },
  }
}
