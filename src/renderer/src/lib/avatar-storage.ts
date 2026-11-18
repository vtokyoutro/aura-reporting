import { inspectAvatarFile, MAX_AVATAR_BYTES } from './avatar-image'

const bucket = 'staff-avatars'
const accountId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

export type AvatarScope = {
  readonly userId: string
  readonly controller: AbortController
  readonly accessToken: string
}

export type AvatarStorage = {
  load: (scope: AvatarScope) => Promise<Blob | null>
  save: (scope: AvatarScope, image: Blob) => Promise<void>
  remove: (scope: AvatarScope) => Promise<void>
}

function objectPath(scope: AvatarScope): string {
  scope.controller.signal.throwIfAborted()
  if (!accountId.test(scope.userId) || !scope.accessToken) throw new Error('Сессия завершена.')
  return `${scope.userId}/avatar.webp`
}

async function readLimitedImage(response: Response): Promise<Blob> {
  if (Number(response.headers.get('content-length')) > MAX_AVATAR_BYTES || !response.body) {
    throw new Error('Файл аватарки недоступен или слишком велик.')
  }
  const reader = response.body.getReader()
  const parts: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_AVATAR_BYTES) {
        await reader.cancel()
        throw new Error('Файл аватарки слишком велик.')
      }
      parts.push(Uint8Array.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return new Blob(parts, { type: 'image/webp' })
}

export function createAvatarStorage(
  url: string,
  apiKey: string,
  request: typeof fetch = fetch
): AvatarStorage {
  const endpoint = new URL(`/storage/v1/object/${bucket}`, url).href

  async function send(
    scope: AvatarScope,
    target: string,
    init: RequestInit = {}
  ): Promise<Response> {
    const signal = scope.controller.signal
    signal.throwIfAborted()
    const response = await request(target, {
      ...init,
      headers: { ...init.headers, apikey: apiKey, Authorization: `Bearer ${scope.accessToken}` },
      signal,
      cache: 'no-store',
      redirect: 'error'
    })
    signal.throwIfAborted()
    return response
  }

  return {
    async load(scope): Promise<Blob | null> {
      const path = objectPath(scope)
      const response = await send(scope, `${endpoint}/${path}`)
      if (!response.ok) {
        const error: { error?: string; code?: string; message?: string } | null = await response
          .json()
          .catch(() => null)
        scope.controller.signal.throwIfAborted()
        if (
          error?.code === 'NoSuchKey' ||
          error?.error === 'NoSuchKey' ||
          error?.message === 'Object not found'
        )
          return null
        throw new Error('Не удалось загрузить аватарку. Проверьте доступ к хранилищу.')
      }
      const image = await readLimitedImage(response)
      scope.controller.signal.throwIfAborted()
      return image
    },
    async save(scope, image): Promise<void> {
      const path = objectPath(scope)
      if (
        image.size > MAX_AVATAR_BYTES ||
        image.type !== 'image/webp' ||
        (await inspectAvatarFile(image)) !== 'webp'
      ) {
        throw new Error('Подготовленная аватарка не соответствует формату WebP.')
      }
      const response = await send(scope, `${endpoint}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'image/webp', 'x-upsert': 'true', 'cache-control': 'no-store' },
        body: image
      })
      if (!response.ok) throw new Error('Не удалось сохранить аватарку. Попробуйте ещё раз.')
    },
    async remove(scope): Promise<void> {
      const path = objectPath(scope)
      const response = await send(scope, endpoint, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] })
      })
      if (!response.ok) throw new Error('Не удалось удалить аватарку.')
      const removed: unknown = await response.json().catch(() => null)
      scope.controller.signal.throwIfAborted()
      if (!Array.isArray(removed) || !removed.some((item) => item?.name === path)) {
        throw new Error('Хранилище не подтвердило удаление аватарки.')
      }
    }
  }
}
