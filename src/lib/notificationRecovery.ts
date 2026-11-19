// Coalesces bursts while preserving one trailing refresh after an in-flight query.
export function createRecovery(refresh: () => Promise<void>, delay = 150) {
  let disposed = false, running = false, pending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  async function run() {
    timer = undefined
    if (disposed || running) return
    running = true
    pending = false
    try { await refresh() } finally {
      running = false
      if (pending && !disposed) timer = setTimeout(() => void run(), delay)
    }
  }
  return {
    request() {
      if (disposed) return
      pending = true
      if (!running && !timer) timer = setTimeout(() => void run(), delay)
    },
    dispose() { disposed = true; clearTimeout(timer) },
  }
}
