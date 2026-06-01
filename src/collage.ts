// Core collage layout + rendering logic.
// Photos are center-cropped to fill grid cells. Two layout modes are supported:
//   - 'grid'  : cells have a fixed aspect ratio; the canvas grows downward.
//   - 'story' : a fixed phone-shaped canvas the photos tile to fill edge-to-edge.

export type LayoutMode = 'grid' | 'story'

export interface AspectPreset {
  id: string
  label: string
  ratio: number // width / height
}

export interface ResolutionPreset {
  id: string
  label: string
  tileWidth: number // grid: px width per tile · story: half the canvas width
}

export interface Cell {
  dx: number
  dy: number
  dw: number
  dh: number
}

export interface Placement {
  width: number
  height: number
  cols: number
  rows: number
  cells: Cell[]
}

// A source ready to draw (preview path: a small downscaled image already decoded).
export interface DrawableImage {
  source: CanvasImageSource
  width: number
  height: number
}

// Metadata for the hi-res export path: the original File is decoded on demand.
export interface ExportItem {
  file: Blob
  width: number
  height: number
}

// Tile aspect-ratio presets for GRID mode (width / height). Phone-portrait first.
export const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'phone-tall', label: 'Phone — Tall (9:19.5)', ratio: 9 / 19.5 },
  { id: 'phone', label: 'Phone (9:16)', ratio: 9 / 16 },
  { id: 'portrait', label: 'Portrait (4:5)', ratio: 4 / 5 },
  { id: 'square', label: 'Square (1:1)', ratio: 1 },
  { id: 'landscape', label: 'Landscape (16:9)', ratio: 16 / 9 },
]

// Canvas aspect-ratio presets for STORY mode (the whole "phone screen" shape).
export const STORY_PRESETS: AspectPreset[] = [
  { id: 'story', label: 'Instagram Story (9:16)', ratio: 9 / 16 },
  { id: 'phone-tall', label: 'Phone — Tall (9:19.5)', ratio: 9 / 19.5 },
  { id: 'portrait', label: 'Portrait Post (4:5)', ratio: 4 / 5 },
  { id: 'square', label: 'Square Post (1:1)', ratio: 1 },
]

// Resolution presets. In grid mode this is the px width per tile; in story mode
// the canvas width is derived from it (see storyCanvasWidth).
export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: 'standard', label: 'Standard', tileWidth: 540 },
  { id: 'high', label: 'High', tileWidth: 1080 },
  { id: 'ultra', label: 'Ultra', tileWidth: 1620 },
  { id: 'max', label: 'Max', tileWidth: 2160 },
]

// Story canvas width derived from a resolution preset.
// Standard => 1080 (a true IG Story), High => 2160, etc.
export function storyCanvasWidth(tileWidth: number): number {
  return tileWidth * 2
}

interface GridConfig {
  columns: number
  tileAspect: number
  tileWidth: number
  gap: number
}

interface StoryConfig {
  columns: number
  canvasWidth: number
  canvasHeight: number
  gap: number
}

// GRID placement: uniform fixed-aspect tiles, canvas height grows with rows.
export function placeGrid(count: number, cfg: GridConfig): Placement {
  const { columns, tileAspect, tileWidth, gap } = cfg
  const cols = Math.max(1, columns)
  const rows = Math.max(1, Math.ceil(count / cols))
  const tileW = Math.round(tileWidth)
  const tileH = Math.round(tileWidth / tileAspect)
  const width = cols * tileW + gap * (cols + 1)
  const height = rows * tileH + gap * (rows + 1)

  const cells: Cell[] = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    cells.push({
      dx: gap + col * (tileW + gap),
      dy: gap + row * (tileH + gap),
      dw: tileW,
      dh: tileH,
    })
  }
  return { width, height, cols, rows, cells }
}

// STORY placement: fixed phone-shaped canvas; cells divide it to fill exactly.
export function placeStory(count: number, cfg: StoryConfig): Placement {
  const { columns, canvasWidth, canvasHeight, gap } = cfg
  const cols = Math.max(1, columns)
  const rows = Math.max(1, Math.ceil(count / cols))
  const width = Math.round(canvasWidth)
  const height = Math.round(canvasHeight)
  const cellW = (width - gap * (cols + 1)) / cols
  const cellH = (height - gap * (rows + 1)) / rows

  const cells: Cell[] = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    cells.push({
      dx: gap + col * (cellW + gap),
      dy: gap + row * (cellH + gap),
      dw: cellW,
      dh: cellH,
    })
  }
  return { width, height, cols, rows, cells }
}

interface CropRect {
  sx: number
  sy: number
  cropW: number
  cropH: number
}

// Center-crop source rect that matches the target aspect ratio.
function centerCropRect(sw: number, sh: number, targetW: number, targetH: number): CropRect {
  const targetAspect = targetW / targetH
  const sourceAspect = sw / sh
  let cropW: number
  let cropH: number
  if (sourceAspect > targetAspect) {
    cropH = sh
    cropW = sh * targetAspect
  } else {
    cropW = sw
    cropH = sw / targetAspect
  }
  return { sx: (sw - cropW) / 2, sy: (sh - cropH) / 2, cropW, cropH }
}

function prepareCanvas(canvas: HTMLCanvasElement, placement: Placement, background: string) {
  canvas.width = placement.width
  canvas.height = placement.height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = background
  ctx.fillRect(0, 0, placement.width, placement.height)
  return ctx
}

// Render using already-decoded sources (live preview).
export function renderPlacement(
  canvas: HTMLCanvasElement,
  placement: Placement,
  sources: DrawableImage[],
  background: string,
): void {
  const ctx = prepareCanvas(canvas, placement, background)
  for (let i = 0; i < placement.cells.length; i++) {
    const img = sources[i]
    if (!img?.source) continue
    const { dx, dy, dw, dh } = placement.cells[i]
    const { sx, sy, cropW, cropH } = centerCropRect(img.width, img.height, dw, dh)
    ctx.drawImage(img.source, sx, sy, cropW, cropH, dx, dy, dw, dh)
  }
}

// High-resolution render for export. Decodes each source from its original
// File one at a time (and releases it immediately) so exporting hundreds of
// full-resolution photos stays within a bounded memory footprint.
export async function renderPlacementHiRes(
  canvas: HTMLCanvasElement,
  placement: Placement,
  items: ExportItem[],
  background: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const ctx = prepareCanvas(canvas, placement, background)
  for (let i = 0; i < placement.cells.length; i++) {
    const item = items[i]
    const { dx, dy, dw, dh } = placement.cells[i]
    let bmp: ImageBitmap | undefined
    try {
      bmp = await createImageBitmap(item.file)
      const { sx, sy, cropW, cropH } = centerCropRect(bmp.width, bmp.height, dw, dh)
      ctx.drawImage(bmp, sx, sy, cropW, cropH, dx, dy, dw, dh)
    } finally {
      bmp?.close()
    }
    onProgress?.(i + 1, items.length)
  }
}
