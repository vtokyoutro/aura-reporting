import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import {
  avatarDataUrl,
  inspectAvatarFile,
  prepareAvatar
} from '../src/renderer/src/lib/avatar-image.ts'

const maxBytes = 5 * 1024 * 1024
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)
const webp = Uint8Array.of(
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

function setTestGlobal(context: TestContext, name: string, value: unknown): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { value, configurable: true })
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous)
    else Reflect.deleteProperty(globalThis, name)
  })
}

function pngWithDimensions(width: number, height: number): Blob {
  const header = new Uint8Array(24)
  header.set(png)
  header.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  const dimensions = new DataView(header.buffer)
  dimensions.setUint32(16, width)
  dimensions.setUint32(20, height)
  return new Blob([header], { type: 'image/png' })
}

test('recognizes PNG, JPEG and WebP from bytes', async () => {
  assert.equal(await inspectAvatarFile(new Blob([png], { type: 'image/png' })), 'png')
  assert.equal(await inspectAvatarFile(new Blob([jpeg])), 'jpeg')
  assert.equal(
    await inspectAvatarFile(new Blob([webp], { type: 'application/octet-stream' })),
    'webp'
  )
})

test('rejects spoofed or truncated signatures and mismatched MIME types', async () => {
  await assert.rejects(inspectAvatarFile(new File(['<svg/>'], 'avatar.png', { type: 'image/png' })))
  await assert.rejects(inspectAvatarFile(new Blob([png.slice(0, 4)])))
  await assert.rejects(inspectAvatarFile(new Blob([jpeg.slice(0, 2)])))
  await assert.rejects(inspectAvatarFile(new Blob([webp.slice(0, 11)])))
  await assert.rejects(inspectAvatarFile(new Blob([png], { type: 'image/jpeg' })))
})

test('accepts exactly 5 MiB and rejects a larger image before decoding', async () => {
  const atLimit = new Blob([png, new Uint8Array(maxBytes - png.length)], { type: 'image/png' })
  const overLimit = new Blob([atLimit, Uint8Array.of(0)], { type: 'image/png' })
  assert.equal(await inspectAvatarFile(atLimit), 'png')
  await assert.rejects(inspectAvatarFile(overLimit))
})

test('crops a decoded avatar to a centered 256 by 256 WebP and releases the bitmap', async (context) => {
  const source = pngWithDimensions(480, 320)
  const encoded = new Blob([webp], { type: 'image/webp' })
  const close = context.mock.fn()
  const bitmap = { width: 480, height: 320, close }
  const drawImage = context.mock.fn()
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob(complete: (blob: Blob) => void, format: string): void {
      assert.equal(format, 'image/webp')
      complete(encoded)
    }
  }

  setTestGlobal(context, 'createImageBitmap', async () => bitmap)
  setTestGlobal(context, 'document', {
    createElement(tag: string): typeof canvas {
      assert.equal(tag, 'canvas')
      return canvas
    }
  })

  assert.equal(await prepareAvatar(source), encoded)
  assert.equal(canvas.width, 256)
  assert.equal(canvas.height, 256)
  assert.deepEqual(drawImage.mock.calls[0].arguments, [bitmap, 80, 0, 320, 320, 0, 0, 256, 256])
  assert.equal(close.mock.callCount(), 1)
})

test('rejects a corrupt file when the image decoder fails after signature inspection', async (context) => {
  const decode = context.mock.fn(async () => {
    throw new DOMException('Invalid image', 'InvalidStateError')
  })
  const createElement = context.mock.fn()
  setTestGlobal(context, 'createImageBitmap', decode)
  setTestGlobal(context, 'document', { createElement })

  const corrupt = pngWithDimensions(480, 320)
  await assert.rejects(prepareAvatar(corrupt))
  assert.equal(decode.mock.callCount(), 1)
  assert.equal(createElement.mock.callCount(), 0)
})

test('rejects oversized dimensions before decoding or canvas allocation', async (context) => {
  const decode = context.mock.fn()
  setTestGlobal(context, 'createImageBitmap', decode)
  await assert.rejects(prepareAvatar(pngWithDimensions(8193, 10)))
  await assert.rejects(prepareAvatar(pngWithDimensions(8192, 8192)))
  assert.equal(decode.mock.callCount(), 0)
})

test('allows a WebP data URL only for an optimized 256 by 256 avatar', async (context) => {
  const header = new Uint8Array(30)
  header.set(webp)
  header.set([0x56, 0x50, 0x38, 0x58], 12)
  header[24] = 255
  header[27] = 255

  const dataUrl = 'data:image/webp;base64,' + Buffer.from(header).toString('base64')
  const reads = context.mock.fn()
  class FileReaderFixture {
    result: string | null = null
    onload?: () => void

    readAsDataURL(blob: Blob): void {
      reads(blob.type)
      this.result = dataUrl
      this.onload?.()
    }
  }
  setTestGlobal(context, 'FileReader', FileReaderFixture)

  assert.equal(await avatarDataUrl(new Blob([header], { type: 'image/webp' })), dataUrl)
  header[27] = 254
  await assert.rejects(avatarDataUrl(new Blob([header], { type: 'image/webp' })))
  await assert.rejects(avatarDataUrl(new Blob([png], { type: 'image/png' })))
  assert.equal(reads.mock.callCount(), 1)
  assert.deepEqual(reads.mock.calls[0].arguments, ['image/webp'])
})
