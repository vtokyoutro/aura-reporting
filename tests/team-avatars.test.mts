import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTeamAvatars } from '../src/renderer/src/lib/team-avatars.ts'

test('bounds parallel reads, preserves fallback and reloads on a new batch', async () => {
  let active = 0
  let peak = 0
  let calls = 0
  const ids = Array.from({ length: 20 }, (_, i) => String(i))
  const load = async (id: string): Promise<string | null> => {
    calls++
    peak = Math.max(peak, ++active)
    await new Promise((resolve) => setImmediate(resolve))
    active--
    if (id === '1') throw new Error('denied')
    return id === '2' ? null : 'data:' + id
  }
  const result = await loadTeamAvatars(ids, new AbortController().signal, load)
  assert.equal(peak, 3)
  assert.equal(result.failed, true)
  assert.equal(result.images['1'], null)
  assert.equal(result.images['2'], null)
  await loadTeamAvatars(ids, new AbortController().signal, load)
  assert.equal(calls, 40)
})

test('aborting a batch discards late results and stops queued reads', async () => {
  const controller = new AbortController()
  let calls = 0
  const result = loadTeamAvatars(['1', '2', '3', '4'], controller.signal, async () => {
    calls++
    await new Promise((resolve) => setImmediate(resolve))
    return 'late'
  })
  controller.abort()
  await assert.rejects(result, { name: 'AbortError' })
  assert.equal(calls, 3)
})
