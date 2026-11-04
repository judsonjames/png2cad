# Working on png2cad

png2cad turns an image into clean SVG, DXF and 3MF files. Project context lives outside this repository. If the operator supplies a context location, read its Start Here, Standing Rules and Open Items before changing design or code. Do not record that location in committed files.

## Engineering

- The app is static: no server, accounts, analytics or runtime CDN. User files stay in the browser
- Geometry lives in `packages/core` and `packages/formats`, which have no DOM or React and run in Node and a Web Worker
- All image and geometry work runs in a worker, never on the page's thread
- Dimensions are millimeters internally. Convert units only at input, display and export
- A job is deterministic: the same input gives the same bytes, including ZIP times
- Never fix a problem silently. Report it as a finding; a part that comes out empty stops the job
- Free every `manifold-3d` object through the `scope` helper in `packages/formats/src/mesh.ts`
- Keep evidence levels distinct: computed, read back by a verifier, sliced by command line, opened in a slicer or design app, printed. Do not claim a level that was not reached

## Verifying

- `verify.ts` reads finished bytes and shares no code with the writers. Keep it that way
- `skill/scripts/verify_*.py` are a second, independent set. Run them on real output after changing a writer: they caught faults the TypeScript checks missed
- A passing check is not the same as looking right. Open SVGs zoomed in, and look at the 3D plate
- Run `npm run check`, then `npm run build` and `npm run smoke`. `PNG2CAD_SAMPLES` points the smoke test at real artwork, which is not kept in this repository

## Interface

Desktop web app. Build screens from `packages/ui`, use design tokens instead of color literals, and follow `docs/interface-guidelines.md`. Components take data through props and never call the engine; only `apps/web/src/store.ts` starts work.

This project stands alone. Do not bring in another project's names, terms, class prefixes, storage keys, decision numbers or links, including in comments and documentation. `npm run audit` takes a term list from outside this repository.

## Dependencies

Pin exact versions and keep `package-lock.json`. Permissive licenses only; LGPL only as a separately loaded file; no AGPL code or data. That rules out reusing other tools' code, and bundling Bambu Studio's presets: the app takes settings from a project file the user provides. Bundle everything the app needs at runtime.

## Privacy and Git

This repository is intended to be public. Never commit personal names, usernames, home-directory paths, device addresses, credentials, private URLs or other people's artwork. Use placeholders.

Do not commit or push unless the operator asks for that specific change.
