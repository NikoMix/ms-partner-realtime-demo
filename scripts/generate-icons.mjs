import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { Buffer } from 'node:buffer'

const publicDir = path.resolve('public')

const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i += 1) {
  let c = i
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[i] = c >>> 0
}

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const crcInput = Buffer.concat([typeBuffer, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcInput), 0)

  return Buffer.concat([length, typeBuffer, data, crc])
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '')
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ]
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function gradientColor(x, y, size) {
  const indigo = hexToRgb('#4f46e5')
  const cyan = hexToRgb('#0ea5e9')
  const night = hexToRgb('#0b1020')

  const diagonal = (x + y) / (size * 2)
  const sweep = Math.min(1, Math.max(0, diagonal * 1.15))
  const bright = indigo.map((channel, index) => mix(channel, cyan[index], sweep))
  const vignette = Math.min(1, Math.max(0, (diagonal - 0.2) / 0.9))

  return bright.map((channel, index) => mix(channel, night[index], vignette * 0.42))
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const right = left + width
  const bottom = top + height
  const clampedX = Math.max(left + radius, Math.min(x, right - radius))
  const clampedY = Math.max(top + radius, Math.min(y, bottom - radius))
  const dx = x - clampedX
  const dy = y - clampedY
  return dx * dx + dy * dy <= radius * radius
}

function blendPixel(pixels, size, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return

  const index = (Math.floor(y) * size + Math.floor(x)) * 4
  const sourceAlpha = alpha / 255
  const destinationAlpha = pixels[index + 3] / 255
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)

  if (outputAlpha === 0) return

  pixels[index] = Math.round(
    (color[0] * sourceAlpha + pixels[index] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha,
  )
  pixels[index + 1] = Math.round(
    (color[1] * sourceAlpha + pixels[index + 1] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  )
  pixels[index + 2] = Math.round(
    (color[2] * sourceAlpha + pixels[index + 2] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  )
  pixels[index + 3] = Math.round(outputAlpha * 255)
}

function fillRoundedRect(pixels, size, left, top, width, height, radius, color) {
  const startX = Math.floor(left)
  const endX = Math.ceil(left + width)
  const startY = Math.floor(top)
  const endY = Math.ceil(top + height)

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      if (insideRoundedRect(x + 0.5, y + 0.5, left, top, width, height, radius)) {
        blendPixel(pixels, size, x, y, color)
      }
    }
  }
}

function fillEllipseStroke(pixels, size, centerX, centerY, radiusX, radiusY, stroke, color) {
  const startX = Math.floor(centerX - radiusX - stroke)
  const endX = Math.ceil(centerX + radiusX + stroke)
  const startY = Math.floor(centerY - stroke)
  const endY = Math.ceil(centerY + radiusY + stroke)

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const nx = (x + 0.5 - centerX) / radiusX
      const ny = (y + 0.5 - centerY) / radiusY
      const distance = Math.sqrt(nx * nx + ny * ny)
      const angle = Math.atan2(ny, nx)
      const isLowerArc = angle > 0.08 * Math.PI && angle < 0.92 * Math.PI
      const strokeWidth = stroke / Math.min(radiusX, radiusY)

      if (isLowerArc && Math.abs(distance - 1) <= strokeWidth) {
        blendPixel(pixels, size, x, y, color)
      }
    }
  }
}

function drawMicrophone(pixels, size, maskable) {
  const white = [255, 255, 255]
  const centerX = size / 2
  const bodyWidth = size * (maskable ? 0.2 : 0.24)
  const bodyHeight = size * (maskable ? 0.35 : 0.4)
  const bodyLeft = centerX - bodyWidth / 2
  const bodyTop = size * (maskable ? 0.25 : 0.22)
  const bodyBottom = bodyTop + bodyHeight

  fillRoundedRect(pixels, size, bodyLeft, bodyTop, bodyWidth, bodyHeight, bodyWidth / 2, white)

  const arcCenterY = size * (maskable ? 0.5 : 0.49)
  fillEllipseStroke(
    pixels,
    size,
    centerX,
    arcCenterY,
    size * (maskable ? 0.23 : 0.27),
    size * (maskable ? 0.21 : 0.24),
    size * 0.035,
    white,
  )

  const stemWidth = size * 0.055
  const stemTop = bodyBottom + size * 0.02
  const stemHeight = size * (maskable ? 0.13 : 0.15)
  fillRoundedRect(
    pixels,
    size,
    centerX - stemWidth / 2,
    stemTop,
    stemWidth,
    stemHeight,
    stemWidth / 2,
    white,
  )

  const baseWidth = size * (maskable ? 0.27 : 0.31)
  const baseHeight = size * 0.055
  fillRoundedRect(
    pixels,
    size,
    centerX - baseWidth / 2,
    stemTop + stemHeight - baseHeight * 0.25,
    baseWidth,
    baseHeight,
    baseHeight / 2,
    white,
  )
}

function renderIcon({ size, maskable = false, transparentCorners = true }) {
  const pixels = Buffer.alloc(size * size * 4)
  const radius = maskable || !transparentCorners ? 0 : size * 0.22

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const shouldFill =
        maskable ||
        !transparentCorners ||
        insideRoundedRect(x + 0.5, y + 0.5, 0, 0, size, size, radius)

      if (!shouldFill) continue

      const [r, g, b] = gradientColor(x, y, size)
      const index = (y * size + x) * 4
      pixels[index] = r
      pixels[index + 1] = g
      pixels[index + 2] = b
      pixels[index + 3] = 255
    }
  }

  drawMicrophone(pixels, size, maskable)

  return pixels
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const scanlines = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4)
    scanlines[rowStart] = 0
    pixels.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scanlines)),
    chunk('IEND'),
  ])
}

function writeIcon(fileName, options) {
  const { size } = options
  const pixels = renderIcon(options)
  const png = encodePng(size, size, pixels)
  const filePath = path.join(publicDir, fileName)

  fs.writeFileSync(filePath, png)

  const written = fs.readFileSync(filePath)
  const width = written.readUInt32BE(16)
  const height = written.readUInt32BE(20)

  if (width !== size || height !== size) {
    throw new Error(
      `${fileName} has invalid dimensions ${width}x${height}, expected ${size}x${size}`,
    )
  }

  console.log(`${fileName}: ${written.length} bytes, ${width}x${height}`)
}

fs.mkdirSync(publicDir, { recursive: true })

writeIcon('pwa-192x192.png', { size: 192 })
writeIcon('pwa-512x512.png', { size: 512 })
writeIcon('pwa-maskable-192x192.png', {
  size: 192,
  maskable: true,
  transparentCorners: false,
})
writeIcon('pwa-maskable-512x512.png', {
  size: 512,
  maskable: true,
  transparentCorners: false,
})
writeIcon('apple-touch-icon.png', {
  size: 180,
  transparentCorners: false,
})
