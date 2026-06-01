# 💞 Photo Collage Maker

A tiny, front-end-only tool that tiles a pile of photos into a single
high-resolution collage. Drop in hundreds of photos, each one gets
center-cropped and laid out in a grid you can preview and export.

Built with **Vite + React + TypeScript**. No backend, no database — everything
runs in your browser, and your photos never leave your machine.

## How it works

1. **Add photos** — drag-and-drop or click _Add photos_ (select hundreds at once).
2. Each photo is **center-cropped** to the chosen tile shape (phone-portrait by
   default; horizontal photos just get the center crop).
3. Photos are **tiled in rows** to fill the canvas, in upload order (or hit
   _Shuffle_).
4. **Preview** updates live as you tweak columns, tile shape, gap, and background.
5. **Export** a single PNG or JPEG at your chosen resolution.

### Controls

| Control    | What it does                                                            |
| ---------- | ----------------------------------------------------------------------- |
| Columns    | How many photos per row.                                                |
| Tile shape | Aspect ratio each photo is cropped to (Phone 9:19.5 / 9:16, 4:5, 1:1…). |
| Resolution | Pixel width per tile — drives the final output resolution.              |
| Gap        | Spacing between photos (uses the background color).                     |
| Background | Fill shown in gaps and any trailing empty cells.                        |
| Format     | PNG (lossless) or JPEG (smaller file).                                  |

The sidebar shows the exact output dimensions and megapixels live. Very large
outputs are flagged, since a single canvas has browser size limits — lower the
resolution or add columns to shrink it.

## Performance notes

- On load, each photo is downscaled to a small **preview** image (so the live
  preview stays fast and memory stays bounded with hundreds of photos).
- On **export**, full-resolution photos are decoded **one at a time** and
  released immediately, so memory stays low even at Max resolution.

## Develop locally

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
npm run typecheck  # type-check only
```
