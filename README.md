# png2cad

Turn an image into clean, working files, entirely in your browser. Nothing is uploaded.

| File | For                                         | What you get                                                                  |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| SVG  | Affinity, Illustrator, printing on products | Filled shapes in real size, one layer per color, Bézier curves that scale     |
| DXF  | Onshape and other CAD                       | R12 polylines where every closed area selects as one region, ready to extrude |
| 3MF  | Bambu Studio, Orca Slicer                   | A ready-to-slice plate, with each color assigned its own filament             |

It works best on line art and flat-color logos. Lines and gaps are fitted to your nozzle, so what you see is what can print, and every file is read back and checked before you download it.

## Using it

Drop an image, set the output size, pick SVG, DXF or 3MF, then select Make.

- **Line Art** is for one color on a plain background. **Flat Colors** is for logos. The app picks one from the image
- **Keep Enclosed Background** keeps the white parts of a logo on white, so a plate stays in one piece
- **Crop** away anything that is not the art. A source about 400 pixels across or larger traces best
- **3MF in Bambu Studio:** a plain 3MF opens with File > Import. To open plates with your printer and filaments set, choose Add Bambu Template and pick any project saved from Bambu Studio

## On an iPad or phone

It works on phones and tablets, upright or sideways. Art from Procreate and other drawing apps works well: share it as a PNG, then choose it in the app.

- **Install it:** in Safari, Share, then Add to Home Screen. It opens full screen, and once opened it works without a connection
- **Share** sends a finished file straight to Affinity, Files or another app. Download is still there
- Very large images are read at up to 4096 x 4096 pixels, which is what phones and tablets can handle, and the app says when it does this
- An update to the app arrives the next time you open it after closing it

## Development

Needs Node 24.

```bash
npm install
npm run dev
npm run check
```

The browser tests run in Edge by default. `npm run smoke:webkit --workspace apps/web` runs them in WebKit, the engine Safari uses, after `npx playwright install webkit`. The home screen icons are drawn from `public/favicon.svg` by `node scripts/icons.mjs` in `apps/web`.

```bash
npm run build
npm run smoke
```

The site builds to `apps/web/dist` with relative paths, so any static host works. There is a command line on the same engine:

```bash
node apps/cli/src/main.ts logo.png --mode auto --width 76mm --svg --dxf --3mf --nozzle 0.2,0.4
```

## Layout

| Folder             | Holds                                                             |
| ------------------ | ----------------------------------------------------------------- |
| `packages/core`    | Image to label map, nozzle fit, boundary tracing, curve fitting   |
| `packages/formats` | DXF, SVG and 3MF writers, independent verifiers, the job pipeline |
| `packages/ui`      | Design tokens, fonts and React components                         |
| `apps/web`         | The static app and its worker                                     |
| `apps/cli`         | The command line                                                  |
| `skill`            | The original agent skill in Python, and its independent verifiers |

## License

BSD-3-Clause. Fira Sans and Fira Code are under the SIL Open Font License; see `packages/ui/fonts`. `manifold-3d` is under the Apache License 2.0.
