/** CDP network events for one camera session. Redirects retain their request id. */
export function gazeNetworkCounter() {
  const pending = new Map<string, { texture: boolean; cached: boolean }>()
  let textureBytes = 0
  let otherBytes = 0
  let textureRequests = 0
  let failedRequests = 0
  let unmeasuredRedirects = 0
  let lastActivity = Date.now()

  const account = (request: { texture: boolean; cached: boolean }, encodedBytes: number) => {
    const bytes = request.cached ? 0 : encodedBytes
    if (request.texture) textureBytes += bytes
    else otherBytes += bytes
  }

  return {
    request(id: string, url: string, redirectBytes?: number) {
      lastActivity = Date.now()
      const previous = pending.get(id)
      if (previous) {
        if (redirectBytes === undefined) unmeasuredRedirects++
        else account(previous, redirectBytes)
      }
      pending.set(id, { texture: new URL(url).pathname.includes('/textures/'), cached: false })
    },
    cache(id: string) {
      const request = pending.get(id)
      if (request) request.cached = true
    },
    finish(id: string, encodedBytes: number) {
      lastActivity = Date.now()
      const request = pending.get(id)
      if (!request) return
      account(request, encodedBytes)
      // One finished request, however many redirect hops it followed.
      if (request.texture) textureRequests++
      pending.delete(id)
    },
    fail(id: string) {
      lastActivity = Date.now()
      if (pending.delete(id)) failedRequests++
    },
    get pending() {
      return pending.size
    },
    get idleMs() {
      return Date.now() - lastActivity
    },
    reading() {
      return {
        textureBytes,
        otherBytes,
        textureRequests,
        failedRequests,
        unfinishedRequests: pending.size,
        unmeasuredRedirects,
      }
    },
  }
}
