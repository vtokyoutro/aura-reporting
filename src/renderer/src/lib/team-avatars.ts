// Load only the visible page, with a bounded number of requests and no polling.
export async function loadTeamAvatars(
  ids: string[],
  signal: AbortSignal,
  load: (id: string) => Promise<string | null>
): Promise<{ images: Record<string, string | null>; failed: boolean }> {
  const images: Record<string, string | null> = {}
  let next = 0
  let failed = false
  async function worker(): Promise<void> {
    while (!signal.aborted && next < ids.length) {
      const id = ids[next++]
      try {
        const source = await load(id)
        signal.throwIfAborted()
        images[id] = source
      } catch {
        if (signal.aborted) return
        failed = true
        images[id] = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker))
  signal.throwIfAborted()
  return { images, failed }
}
