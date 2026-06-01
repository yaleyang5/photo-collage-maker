import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ASPECT_PRESETS,
  STORY_PRESETS,
  RESOLUTION_PRESETS,
  placeGrid,
  placeStory,
  renderPlacement,
  renderPlacementHiRes,
  storyCanvasWidth,
  type LayoutMode,
  type Placement,
  type DrawableImage,
} from './collage'
import './App.css'

// One loaded photo: original File kept for hi-res export, plus a small
// downscaled preview canvas used for the live preview render.
interface LoadedImage {
  id: string
  name: string
  file: File
  width: number
  height: number
  preview: HTMLCanvasElement
}

// Longest side (px) of the cached preview image. Keeps memory bounded when
// hundreds of high-res photos are loaded.
const PREVIEW_SOURCE_MAX = 512
// Cap the longest side of the live preview canvas so re-rendering stays fast.
const PREVIEW_CANVAS_MAX = 1800
// Conservative single-canvas limits for broad browser compatibility.
const SAFE_MAX_DIMENSION = 16384
const SAFE_MAX_AREA = 268_435_456 // ~256 megapixels

let idCounter = 0
const nextId = () => `img-${idCounter++}`

// Decode a file, capture its natural dimensions, and build a small preview
// canvas. The full-resolution bitmap is released immediately.
async function loadImage(file: File): Promise<LoadedImage | null> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    return null // not a decodable image
  }
  const { width, height } = bmp
  const scale = Math.min(1, PREVIEW_SOURCE_MAX / Math.max(width, height))
  const pw = Math.max(1, Math.round(width * scale))
  const ph = Math.max(1, Math.round(height * scale))
  const preview = document.createElement('canvas')
  preview.width = pw
  preview.height = ph
  const ctx = preview.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, pw, ph)
  bmp.close()
  return { id: nextId(), name: file.name, file, width, height, preview }
}

function formatDimensions(w: number, h: number): string {
  const mp = (w * h) / 1_000_000
  return `${w.toLocaleString()} × ${h.toLocaleString()} px · ${mp.toFixed(1)} MP`
}

// Dim the hovered cell and draw a "remove" ✕ so it's clear clicking deletes it.
function drawHoverOverlay(
  canvas: HTMLCanvasElement,
  placement: Placement,
  hovered: number | null,
): void {
  if (hovered == null || hovered >= placement.cells.length) return
  const { dx, dy, dw, dh } = placement.cells[hovered]
  const ctx = canvas.getContext('2d')!
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(dx, dy, dw, dh)

  const r = Math.max(8, Math.min(dw, dh) * 0.14)
  const cx = dx + dw / 2
  const cy = dy + dh / 2
  ctx.fillStyle = '#ff5d8f'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#fff'
  ctx.lineWidth = Math.max(2, r * 0.16)
  ctx.lineCap = 'round'
  const k = r * 0.45
  ctx.beginPath()
  ctx.moveTo(cx - k, cy - k)
  ctx.lineTo(cx + k, cy + k)
  ctx.moveTo(cx + k, cy - k)
  ctx.lineTo(cx - k, cy + k)
  ctx.stroke()
  ctx.restore()
}

export default function App() {
  const [images, setImages] = useState<LoadedImage[]>([])
  const [mode, setMode] = useState<LayoutMode>('grid')
  const [columns, setColumns] = useState(6)
  const [gridAspectId, setGridAspectId] = useState(ASPECT_PRESETS[0].id)
  const [storyAspectId, setStoryAspectId] = useState(STORY_PRESETS[0].id)
  const [resolutionId, setResolutionId] = useState(RESOLUTION_PRESETS[1].id)
  const [gap, setGap] = useState(0)
  const [background, setBackground] = useState('#ffffff')
  const [format, setFormat] = useState<'png' | 'jpeg'>('png')

  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null)
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)

  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The placement currently drawn to the preview canvas, in canvas-pixel space.
  // Used to hit-test clicks/hovers back to a photo index.
  const previewPlacementRef = useRef<Placement | null>(null)

  const resolution = useMemo(
    () => RESOLUTION_PRESETS.find((r) => r.id === resolutionId) ?? RESOLUTION_PRESETS[1],
    [resolutionId],
  )
  const gridAspect = useMemo(
    () => ASPECT_PRESETS.find((a) => a.id === gridAspectId) ?? ASPECT_PRESETS[0],
    [gridAspectId],
  )
  const storyAspect = useMemo(
    () => STORY_PRESETS.find((a) => a.id === storyAspectId) ?? STORY_PRESETS[0],
    [storyAspectId],
  )

  // Build the cell placement for a given photo count and render scale.
  const buildPlacement = useCallback(
    (count: number, scale: number): Placement => {
      if (mode === 'story') {
        const canvasWidth = storyCanvasWidth(resolution.tileWidth) * scale
        const canvasHeight = canvasWidth / storyAspect.ratio
        return placeStory(count, {
          columns,
          canvasWidth,
          canvasHeight,
          gap: gap * scale,
        })
      }
      return placeGrid(count, {
        columns,
        tileAspect: gridAspect.ratio,
        tileWidth: resolution.tileWidth * scale,
        gap: gap * scale,
      })
    },
    [mode, columns, resolution.tileWidth, gridAspect.ratio, storyAspect.ratio, gap],
  )

  // Full-resolution output geometry (what the exported file will be).
  const fullPlacement = useMemo(
    () => buildPlacement(Math.max(images.length, 1), 1),
    [buildPlacement, images.length],
  )

  const oversized =
    fullPlacement.width > SAFE_MAX_DIMENSION ||
    fullPlacement.height > SAFE_MAX_DIMENSION ||
    fullPlacement.width * fullPlacement.height > SAFE_MAX_AREA

  // --- Live preview render -------------------------------------------------
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    if (images.length === 0) {
      canvas.width = 0
      canvas.height = 0
      previewPlacementRef.current = null
      return
    }

    const previewScale = Math.min(
      1,
      PREVIEW_CANVAS_MAX / Math.max(fullPlacement.width, fullPlacement.height),
    )
    const previewPlacement = buildPlacement(images.length, previewScale)
    previewPlacementRef.current = previewPlacement
    const drawables: DrawableImage[] = images.map((img) => ({
      source: img.preview,
      width: img.preview.width,
      height: img.preview.height,
    }))

    const raf = requestAnimationFrame(() => {
      renderPlacement(canvas, previewPlacement, drawables, background)
      drawHoverOverlay(canvas, previewPlacement, hovered)
    })
    return () => cancelAnimationFrame(raf)
  }, [images, buildPlacement, fullPlacement, background, hovered])

  // --- File handling -------------------------------------------------------
  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return

    setLoading({ done: 0, total: files.length })

    // Load with limited concurrency to bound peak memory while decoding.
    const CONCURRENCY = 4
    const results: LoadedImage[] = []
    let index = 0
    let done = 0

    async function worker() {
      while (index < files.length) {
        const myIndex = index++
        const loaded = await loadImage(files[myIndex])
        done++
        setLoading({ done, total: files.length })
        if (loaded) results[myIndex] = loaded
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    setImages((prev) => [...prev, ...results.filter(Boolean)])
    setLoading(null)
  }, [])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files)
    e.target.value = '' // allow re-selecting the same files
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files)
  }

  const clearAll = () => setImages([])

  // Map a pointer event to the photo index under the cursor (-1 if none).
  const cellIndexFromEvent = (e: React.MouseEvent<HTMLCanvasElement>): number => {
    const canvas = previewCanvasRef.current
    const placement = previewPlacementRef.current
    if (!canvas || !placement) return -1
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return -1
    const x = (e.clientX - rect.left) * (canvas.width / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / rect.height)
    const { cells } = placement
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      if (x >= c.dx && x < c.dx + c.dw && y >= c.dy && y < c.dy + c.dh) return i
    }
    return -1
  }

  const onPreviewMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const i = cellIndexFromEvent(e)
    setHovered((prev) => (prev === (i === -1 ? null : i) ? prev : i === -1 ? null : i))
  }

  const onPreviewClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const i = cellIndexFromEvent(e)
    if (i === -1) return
    setHovered(null)
    setImages((prev) => prev.filter((_, idx) => idx !== i))
  }

  const shuffle = () =>
    setImages((prev) => {
      const arr = [...prev]
      // Fisher–Yates
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    })

  // --- Export --------------------------------------------------------------
  const exportCollage = useCallback(async () => {
    if (images.length === 0 || exporting) return
    setExporting({ done: 0, total: images.length })

    const canvas = document.createElement('canvas')
    try {
      const placement = buildPlacement(images.length, 1)
      await renderPlacementHiRes(
        canvas,
        placement,
        images.map((img) => ({ file: img.file, width: img.width, height: img.height })),
        background,
        (done, total) => setExporting({ done, total }),
      )

      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      const quality = format === 'jpeg' ? 0.92 : undefined
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mime, quality),
      )
      if (!blob) throw new Error('Failed to encode image')

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = format === 'png' ? 'png' : 'jpg'
      a.download = `collage-${mode}-${placement.width}x${placement.height}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error(err)
      alert(
        `Export failed — the output may be too large (${formatDimensions(fullPlacement.width, fullPlacement.height)}).\n\n` +
          'Try a lower resolution or more columns to shrink the canvas.',
      )
    } finally {
      canvas.width = 0
      canvas.height = 0
      setExporting(null)
    }
  }, [images, exporting, buildPlacement, background, format, mode, fullPlacement])

  // --- Render --------------------------------------------------------------
  const hasImages = images.length > 0

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <span className="brand-emoji">💞</span>
          <div>
            <h1>Collage Maker</h1>
            <p>Tile your photos into one image</p>
          </div>
        </header>

        <section className="panel">
          <button className="primary" onClick={() => fileInputRef.current?.click()}>
            Add photos
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={onInputChange}
          />
          {hasImages && (
            <div className="photo-actions">
              <span className="count">{images.length} photos</span>
              <button className="link" onClick={shuffle}>
                Shuffle
              </button>
              <button className="link danger" onClick={clearAll}>
                Clear
              </button>
            </div>
          )}
          {loading && (
            <div className="progress">
              Loading {loading.done} / {loading.total}…
            </div>
          )}
        </section>

        <section className="panel">
          <div className="field">
            <span>Layout</span>
            <div className="segmented full">
              <button
                className={mode === 'grid' ? 'active' : ''}
                onClick={() => setMode('grid')}
              >
                Grid
              </button>
              <button
                className={mode === 'story' ? 'active' : ''}
                onClick={() => setMode('story')}
              >
                Phone / Story
              </button>
            </div>
          </div>

          <label className="field">
            <span>
              Columns <strong>{columns}</strong>
            </span>
            <input
              type="range"
              min={1}
              max={30}
              value={columns}
              onChange={(e) => setColumns(Number(e.target.value))}
            />
          </label>

          {mode === 'grid' ? (
            <label className="field">
              <span>Tile shape (phone by default)</span>
              <select value={gridAspectId} onChange={(e) => setGridAspectId(e.target.value)}>
                {ASPECT_PRESETS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>Canvas shape (phone screen)</span>
              <select value={storyAspectId} onChange={(e) => setStoryAspectId(e.target.value)}>
                {STORY_PRESETS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="field">
            <span>Resolution</span>
            <select value={resolutionId} onChange={(e) => setResolutionId(e.target.value)}>
              {RESOLUTION_PRESETS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>
              Gap <strong>{gap}px</strong>
            </span>
            <input
              type="range"
              min={0}
              max={80}
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
            />
          </label>

          <label className="field row">
            <span>Background</span>
            <input
              type="color"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
            />
          </label>
        </section>

        <section className="panel">
          <div className="field row">
            <span>Format</span>
            <div className="segmented">
              <button
                className={format === 'png' ? 'active' : ''}
                onClick={() => setFormat('png')}
              >
                PNG
              </button>
              <button
                className={format === 'jpeg' ? 'active' : ''}
                onClick={() => setFormat('jpeg')}
              >
                JPEG
              </button>
            </div>
          </div>

          <div className="output-info">
            <span>Output</span>
            <strong>{formatDimensions(fullPlacement.width, fullPlacement.height)}</strong>
            <span className="muted">
              {fullPlacement.cols} × {fullPlacement.rows} grid
              {mode === 'story' ? ' · fills the phone screen' : ''}
            </span>
          </div>

          {oversized && (
            <div className="warning">
              This output is very large and may fail to export in some browsers.
              Lower the resolution or add columns to shrink it.
            </div>
          )}

          <button
            className="primary export"
            disabled={!hasImages || exporting !== null}
            onClick={exportCollage}
          >
            {exporting
              ? `Rendering ${exporting.done} / ${exporting.total}…`
              : 'Export collage'}
          </button>
        </section>
      </aside>

      <main
        className={`stage ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {hasImages ? (
          <>
            <div className="click-hint">Click a photo to remove it</div>
            {mode === 'story' ? (
              <div className="phone-frame">
                <div className="phone-notch" />
                <canvas
                  ref={previewCanvasRef}
                  className="preview-canvas phone-screen removable"
                  onMouseMove={onPreviewMove}
                  onMouseLeave={() => setHovered(null)}
                  onClick={onPreviewClick}
                />
              </div>
            ) : (
              <div className="preview-wrap">
                <canvas
                  ref={previewCanvasRef}
                  className="preview-canvas removable"
                  onMouseMove={onPreviewMove}
                  onMouseLeave={() => setHovered(null)}
                  onClick={onPreviewClick}
                />
              </div>
            )}
          </>
        ) : (
          <div className="empty">
            <div className="empty-emoji">🖼️</div>
            <h2>Drop your photos here</h2>
            <p>
              Every photo is center-cropped and tiled into a single
              high-resolution collage. Switch to <strong>Phone / Story</strong> to
              preview it as an Instagram Story. Add hundreds at once.
            </p>
            <button className="primary" onClick={() => fileInputRef.current?.click()}>
              Add photos
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
