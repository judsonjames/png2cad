# png2cad

Turn an image into clean, working files, entirely in your browser. Nothing is uploaded.

| File | For                                         | What you get                                                                  |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| SVG  | Affinity, Illustrator, printing on products | Filled shapes in real size, one layer per color, Bézier curves that scale     |
| DXF  | Onshape and other CAD                       | R12 polylines where every closed area selects as one region, ready to extrude |
| 3MF  | Bambu Studio, Orca Slicer                   | A ready-to-slice plate, with each color assigned its own filament             |

It works best on line art and flat-color logos. Lines and gaps are fitted to your nozzle, so what you see is what can print, and every file is read back and checked before you download it.

## Using it

Drop an image, set the output size, choose your files and nozzles, then select Make Files.

- **Line Art** is for one color on a plain background. **Flat Colors** is for logos. The app picks one from the image
- **Keep Enclosed Background** keeps the white parts of a logo on white, so a plate stays in one piece
- **Crop** away anything that is not the art. A source about 400 pixels across or larger traces best
- **3MF in Bambu Studio:** a plain 3MF opens with File > Import. To open plates with your printer and filaments set, choose Add Bambu Template and pick any project saved from Bambu Studio

## Development

Needs Node 24.

```bash
npm install
npm run dev
npm run check
```

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
