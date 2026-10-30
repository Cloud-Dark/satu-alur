/** Browser-only: decode an image file and re-encode it as JPEG (max side `maxSide`). Covered by the e2e test. */
export async function toJpeg(file, maxSide = 2048) {
  let src
  let release = () => {}
  try {
    if (typeof createImageBitmap === 'function') {
      src = await createImageBitmap(file)
      release = () => src.close?.()
    } else {
      const url = URL.createObjectURL(file)
      release = () => URL.revokeObjectURL(url)
      src = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('x'))
        img.src = url
      })
    }
  } catch {
    throw new Error('Gambar tidak bisa dibaca. Gunakan berkas JPG atau PNG.')
  }
  try {
    const w0 = src.naturalWidth || src.width
    const h0 = src.naturalHeight || src.height
    const scale = Math.min(1, maxSide / Math.max(w0, h0))
    const width = Math.max(1, Math.round(w0 * scale))
    const height = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff' // JPEG has no alpha
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(src, 0, 0, width, height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error('Gambar gagal diproses.')
    return { blob, width, height }
  } finally {
    release()
  }
}
