/** A request on its way: whether it reads a texture, whether the browser answered it from its
 *  cache, and the path of the side's cache file it reads, if it reads one (`/cache/<side>/…`). */
type Pending = { texture: boolean; cached: boolean; cacheFile?: string }

/** CDP network events for one camera session. Redirects retain their request id. Each file of a
 *  side's cache is also counted on its own, by its path, so a reading says what of the cache a
 *  view reads. */
export function gazeNetworkCounter() {
  const pending = new Map<string, Pending>()
  const cacheFiles: Record<string, number> = {}
  let textureBytes = 0
  let otherBytes = 0
  let textureRequests = 0
  let failedRequests = 0
  let unmeasuredRedirects = 0
  let lastActivity = Date.now()

  const account = (request: Pending, encodedBytes: number) => {
    const bytes = request.cached ? 0 : encodedBytes
    if (request.texture) textureBytes += bytes
    else otherBytes += bytes
    if (request.cacheFile)
      cacheFiles[request.cacheFile] = (cacheFiles[request.cacheFile] ?? 0) + bytes
  }

  return {
    request(id: string, url: string, redirectBytes?: number) {
      lastActivity = Date.now()
      const previous = pending.get(id)
      if (previous) {
        if (redirectBytes === undefined) unmeasuredRedirects++
        else account(previous, redirectBytes)
      }
      const path = new URL(url).pathname
      const cacheFile = path.startsWith('/cache/') ? path : undefined
      pending.set(id, { texture: path.includes('/textures/'), cached: false, cacheFile })
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
        cacheFiles: { ...cacheFiles },
      }
    },
  }
}
