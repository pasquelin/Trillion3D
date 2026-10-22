import {
  DEFAULT_STREAMING_BANDWIDTH_LIMIT,
  DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME,
  DEFAULT_STREAMING_MAX_PENDING_PAGES,
  DEFAULT_STREAMING_MAX_REQUESTS,
  DEFAULT_STREAMING_MIN_REQUESTS,
  DEFAULT_STREAMING_NUM_RETRIES,
  DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT,
  DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT,
  DEFAULT_STREAMING_QUALITY_MIN_SCALE,
  type StreamingField,
} from '../contracts/streamingOptions.ts'

/** What each setting of the geometry streaming means (`../contracts/streamingOptions.ts`): a
 *  function, its defaults read when the schema is built. */
export const streamingMeanings = (): Readonly<Record<StreamingField, string>> => ({
  streamingMaxPendingPages: `Streaming pages of 128 KiB the streaming keeps started at once, read and not yet installed (default ${DEFAULT_STREAMING_MAX_PENDING_PAGES}). Each update starts the new streaming pages the views ask for, highest priority first, while fewer are pending. Any other value is refused.`,
  streamingMaxInstallsPerFrame: `Streaming pages of 128 KiB a frame installs at most, in the order they were started (default ${DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME}, never more than streamingMaxPendingPages). No time budget bounds them. Any other value is refused.`,
  streamingQualityMinPoolPercent: `Streaming pool load, in percent of its slots (a 128 KiB streaming page each), under which the quality rises again: after 30 updates under it, the screen error scale grows by 1 % an update (default ${DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT}). Any other value is refused.`,
  streamingQualityMaxPoolPercent: `Streaming pool load, in percent of its slots (a 128 KiB streaming page each), over which the quality falls: after 2 updates over it, the screen error scale shrinks by 3 % an update (default ${DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT}, read no lower than streamingQualityMinPoolPercent). Any other value is refused.`,
  streamingQualityMinScale: `Lowest scale of the screen error the pool pressure falls to (default ${DEFAULT_STREAMING_QUALITY_MIN_SCALE}); 1 never scales: an overcommitted pool then draws the coarser parents of what does not fit. Any other value is refused.`,
  streamingNumRetries: `Times a failed read of a streaming page is tried again, each after a longer wait (default ${DEFAULT_STREAMING_NUM_RETRIES}); after the last, the object the page belongs to is given up: no page of it is asked for again. A negative value tries without end. Any other value is refused.`,
  streamingMinRequests: `Least requests the readout of the camera's cut holds (default ${DEFAULT_STREAMING_MIN_REQUESTS}, from 4096 to 1048576); a request is a leaf the cut keeps and sees, and the readout also bounds the clusters listed drawn. It starts at this size, grows to a quarter over what the cut asks of it and shrinks by 2 % a readback after 30 under half its size, never under this value nor over streamingMaxRequests. Any other value is refused.`,
  streamingMaxRequests: `Most requests the readout of the camera's cut holds (default ${DEFAULT_STREAMING_MAX_REQUESTS}, from 4096 to 1048576), read no lower than streamingMinRequests: a cut past it is read by its head. Any other value is refused.`,
  streamingBandwidthLimit: `Simulated bandwidth of the geometry streaming, in megabytes a second (default ${DEFAULT_STREAMING_BANDWIDTH_LIMIT}, none; any negative value is none): the pages whose bytes are in, in the order they were started, take them, before their install, from the bytes each frame gives them at that rate — what the time since the frame before allows, shared by the pages of the frame —, and the page that has bytes left makes the pages behind it wait; a root page is never slowed. 0 installs no streaming page. To try a slow link. Any other value is refused.`,
})
