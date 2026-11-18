import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const avatarStorageModule = new URL('../src/renderer/src/lib/avatar-storage.ts', import.meta.url)
// Vite resolves extensionless local imports. Use the same resolution for this Node test.
const resolution = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === './avatar-image' && context.parentURL === avatarStorageModule.href
        ? './avatar-image.ts'
        : specifier,
      context
    )
  }
})
const { createAvatarStorage } = await import('../src/renderer/src/lib/avatar-storage.ts')
resolution.deregister()

const endpoint = 'https://avatar-fixture.example.invalid'
const apiKey = 'synthetic-public-key'
const firstId = 'a6133786-6a32-4b00-8e91-3921613446f1'
const secondId = 'b424dc7b-cfba-4fbc-933b-4279fb1453c5'
const image = new Blob(
  [
    Uint8Array.of(
      0x52,
      0x49,
      0x46,
      0x46,
      0x20,
      0,
      0,
      0,
      0x57,
      0x45,
      0x42,
      0x50,
      0x56,
      0x50,
      0x38,
      0x20
    )
  ],
  { type: 'image/webp' }
)

function scope(
  userId: string,
  accessToken = 'fixture-first-token'
): {
  userId: string
  accessToken: string
  controller: AbortController
} {
  return { userId, accessToken, controller: new AbortController() }
}

test('uses private UID-scoped paths and the active token on each request', async () => {
  const requests: { url: URL; init?: RequestInit }[] = []
  const request: typeof fetch = async (input, init) => {
    requests.push({ url: new URL(input instanceof Request ? input.url : input), init })
    if (!init?.method || init.method === 'GET') return new Response(image)
    if (init.method === 'DELETE') return Response.json([{ name: secondId + '/avatar.webp' }])
    return new Response(null, { status: 204 })
  }
  const storage = createAvatarStorage(endpoint, apiKey, request)
  const first = scope(firstId)
  const second = scope(secondId, 'fixture-second-token')

  const restored = await storage.load(first)
  assert.ok(restored)
  assert.deepEqual(await restored.bytes(), await image.bytes())
  await storage.save(second, image)
  second.accessToken = 'fixture-refreshed-token'
  await storage.remove(second)

  const prefix = '/storage/v1/object/staff-avatars'
  assert.deepEqual(
    requests.map(({ url, init }) => [init?.method ?? 'GET', url.origin, url.pathname]),
    [
      [
        'GET',
        endpoint,
        '/storage/v1/object/authenticated/staff-avatars/' + firstId + '/avatar.webp'
      ],
      ['POST', endpoint, prefix + '/' + secondId + '/avatar.webp'],
      ['DELETE', endpoint, prefix]
    ]
  )
  assert.deepEqual(
    requests.map(({ init }) => new Headers(init?.headers).get('authorization')),
    ['Bearer fixture-first-token', 'Bearer fixture-second-token', 'Bearer fixture-refreshed-token']
  )
  assert.ok(requests.every(({ init }) => new Headers(init?.headers).get('apikey') === apiKey))
  assert.ok(requests.every(({ init }) => init?.cache === 'no-store' && init.redirect === 'error'))
  assert.equal(requests[0].init?.signal, first.controller.signal)
  assert.equal(requests[1].init?.signal, second.controller.signal)
  assert.equal(requests[2].init?.signal, second.controller.signal)
  assert.equal(requests[1].init?.body, image)
  assert.equal(new Headers(requests[1].init?.headers).get('x-upsert'), 'true')
  assert.deepEqual(JSON.parse(String(requests[2].init?.body)), {
    prefixes: [secondId + '/avatar.webp']
  })
})

test('returns null for an absent private avatar and reports access errors', async () => {
  let status = 404
  const storage = createAvatarStorage(endpoint, apiKey, async () =>
    Response.json({ code: status === 404 ? 'NoSuchKey' : 'AccessDenied' }, { status })
  )
  assert.equal(await storage.load(scope(firstId)), null)
  status = 403
  await assert.rejects(storage.load(scope(firstId)))
})

test('reads another UID with the viewer token while writes remain scoped to the viewer', async () => {
  const requests: { url: string; init?: RequestInit }[] = []
  const storage = createAvatarStorage(endpoint, apiKey, async (url, init) => {
    requests.push({ url: String(url), init })
    if (init?.method === 'DELETE') return Response.json([{ name: firstId + '/avatar.webp' }])
    return new Response(image)
  })
  const viewer = scope(firstId)
  await storage.load(viewer, secondId)
  await storage.save(viewer, image)
  await storage.remove(viewer)
  assert.ok(
    requests[0].url.endsWith('/object/authenticated/staff-avatars/' + secondId + '/avatar.webp')
  )
  assert.equal(
    new Headers(requests[0].init?.headers).get('authorization'),
    'Bearer fixture-first-token'
  )
  assert.ok(requests[1].url.endsWith('/staff-avatars/' + firstId + '/avatar.webp'))
  assert.deepEqual(JSON.parse(String(requests[2].init?.body)), {
    prefixes: [firstId + '/avatar.webp']
  })
  await assert.rejects(storage.load(viewer, '../' + secondId))
  assert.equal(requests.length, 3)
})

test('handles missing, denied, malformed and network responses without inventing absence', async () => {
  for (const status of [401, 403]) {
    const storage = createAvatarStorage(endpoint, apiKey, async () =>
      Response.json({ code: 'NoSuchKey' }, { status })
    )
    await assert.rejects(storage.load(scope(firstId)))
  }
  for (const payload of [null, [], { code: 'AccessDenied' }, { message: 'Object not found' }]) {
    const storage = createAvatarStorage(endpoint, apiKey, async () =>
      Response.json(payload, { status: 400 })
    )
    await assert.rejects(storage.load(scope(firstId)))
  }
  const missing = createAvatarStorage(endpoint, apiKey, async () =>
    Response.json({ code: 'NoSuchKey' }, { status: 400 })
  )
  assert.equal(await missing.load(scope(firstId)), null)
  const broken = createAvatarStorage(endpoint, apiKey, async () => {
    throw new Error('offline')
  })
  await assert.rejects(broken.load(scope(firstId)))
})

test('rejects invalid account paths and unacknowledged deletes', async () => {
  let calls = 0
  const storage = createAvatarStorage(endpoint, apiKey, async () => {
    calls += 1
    return Response.json([])
  })
  await assert.rejects(storage.load(scope('../' + secondId)))
  await assert.rejects(storage.save(scope(firstId, ''), image))
  assert.equal(calls, 0)
  await assert.rejects(storage.remove(scope(firstId)))
})

test('makes no network request after the avatar scope has already been aborted', async () => {
  const aborted = scope(firstId)
  aborted.controller.abort()
  let calls = 0
  const storage = createAvatarStorage(endpoint, apiKey, async () => {
    calls += 1
    return new Response(null, { status: 204 })
  })

  await assert.rejects(storage.load(aborted), { name: 'AbortError' })
  await assert.rejects(storage.save(aborted, image), { name: 'AbortError' })
  await assert.rejects(storage.remove(aborted), { name: 'AbortError' })
  assert.equal(calls, 0)
})

test('rejects large responses even without a content length and rejects unprepared uploads', async () => {
  const maxStoredBytes = 512 * 1024
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(maxStoredBytes + 1))
    },
    cancel() {
      cancelled = true
    }
  })
  const storage = createAvatarStorage(endpoint, apiKey, async () => new Response(stream))

  await assert.rejects(storage.load(scope(firstId)))
  assert.equal(cancelled, true)
  await assert.rejects(storage.save(scope(firstId), new Blob(['not an image'])))
})

test('discards an avatar response delivered after switching accounts', async (context) => {
  const first = scope(firstId)
  const second = scope(secondId)
  let completeFirst: (response: Response) => void = () => {
    assert.fail('First request has not started')
  }
  const sent = context.mock.fn<typeof fetch>((input) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    if (path.endsWith('/' + firstId + '/avatar.webp')) {
      return new Promise((resolve) => {
        completeFirst = resolve
      })
    }
    return Promise.resolve(Response.json({ error: 'NoSuchKey' }, { status: 404 }))
  })
  const storage = createAvatarStorage(endpoint, apiKey, sent)

  const oldLoad = storage.load(first)
  const rejected = assert.rejects(oldLoad, { name: 'AbortError' })
  first.controller.abort()
  assert.equal(await storage.load(second), null)
  completeFirst(new Response(image))
  await rejected
  assert.equal(sent.mock.callCount(), 2)
})
