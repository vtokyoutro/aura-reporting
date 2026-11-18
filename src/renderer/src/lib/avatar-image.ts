export const MAX_AVATAR_BYTES = 512 * 1024
const MAX_SOURCE_BYTES = 5 * 1024 * 1024
const MAX_SOURCE_SIDE = 8192
const MAX_SOURCE_PIXELS = 32_000_000
const AVATAR_SIDE = 256

type AvatarFormat = 'png' | 'jpeg' | 'webp'

const types: Record<AvatarFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

function textAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  return [...expected].every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0)
  )
}

export async function inspectAvatarFile(file: Blob): Promise<AvatarFormat> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Изображение должно занимать не более 5 МБ.')
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  let format: AvatarFormat | undefined

  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte))
    format = 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) format = 'jpeg'
  if (textAt(bytes, 0, 'RIFF') && textAt(bytes, 8, 'WEBP') && bytes.length >= 16) format = 'webp'

  if (
    !format ||
    (file.type && file.type !== 'application/octet-stream' && file.type !== types[format])
  ) {
    throw new Error('Выберите корректное изображение PNG, JPEG или WebP.')
  }
  return format
}

function jpegDimensions(bytes: Uint8Array, view: DataView): [number, number] | undefined {
  let offset = 2
  while (bytes[offset] === 0xff) {
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break
    const size = view.getUint16(offset)
    if (size < 2 || offset + size > bytes.length) break
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker
      ) &&
      size >= 8
    ) {
      return [view.getUint16(offset + 5), view.getUint16(offset + 3)]
    }
    offset += size
  }
  return undefined
}

function dimensions(buffer: ArrayBuffer, format: AvatarFormat): [number, number] | undefined {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  if (format === 'png' && bytes.length >= 24 && textAt(bytes, 12, 'IHDR'))
    return [view.getUint32(16), view.getUint32(20)]
  if (format === 'jpeg') return jpegDimensions(bytes, view)
  if (format !== 'webp' || bytes.length < 25) return undefined

  if (textAt(bytes, 12, 'VP8X') && bytes.length >= 30) {
    return [
      1 + bytes[24] + 256 * bytes[25] + 65536 * bytes[26],
      1 + bytes[27] + 256 * bytes[28] + 65536 * bytes[29]
    ]
  }
  if (textAt(bytes, 12, 'VP8L') && bytes[20] === 0x2f) {
    const size = view.getUint32(21, true)
    return [1 + (size & 0x3fff), 1 + ((size >>> 14) & 0x3fff)]
  }
  if (
    textAt(bytes, 12, 'VP8 ') &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 1 &&
    bytes[25] === 0x2a
  ) {
    return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff]
  }
  return undefined
}

function checkDimensions(size: [number, number] | undefined): void {
  if (!size || !size[0] || !size[1]) throw new Error('Файл изображения повреждён.')
  if (size.some((side) => side > MAX_SOURCE_SIDE) || size[0] * size[1] > MAX_SOURCE_PIXELS) {
    throw new Error('Изображение слишком большое по ширине или высоте.')
  }
}

export async function prepareAvatar(file: Blob): Promise<Blob> {
  const format = await inspectAvatarFile(file)
  checkDimensions(dimensions(await file.arrayBuffer(), format))

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Не удалось открыть изображение. Проверьте файл и попробуйте ещё раз.')
  })
  try {
    checkDimensions([bitmap.width, bitmap.height])
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIDE
    canvas.height = AVATAR_SIDE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не удалось подготовить изображение.')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIDE,
      AVATAR_SIDE
    )
    const image = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.84)
    )
    if (!image || image.type !== 'image/webp' || !image.size || image.size > MAX_AVATAR_BYTES) {
      throw new Error('Не удалось оптимизировать изображение.')
    }
    return image
  } finally {
    bitmap.close()
  }
}

export async function avatarDataUrl(image: Blob): Promise<string> {
  if (image.size > MAX_AVATAR_BYTES || (await inspectAvatarFile(image)) !== 'webp') {
    throw new Error('Файл аватарки повреждён.')
  }
  const bytes = new Uint8Array(await image.arrayBuffer())
  const size = dimensions(bytes.buffer, 'webp')
  if (size?.[0] !== AVATAR_SIDE || size[1] !== AVATAR_SIDE)
    throw new Error('Неверный размер аватарки.')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Не удалось прочитать аватарку.'))
    reader.onerror = () => reject(new Error('Не удалось прочитать аватарку.'))
    reader.readAsDataURL(new Blob([bytes], { type: 'image/webp' }))
  })
}
