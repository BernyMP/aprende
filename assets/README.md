# Brand icons

Each variant's `icon.svg` is the source of truth for its application icon:

- `dev/icon.svg`
- `nightly/icon.svg`
- `prod/icon.svg`

`icon.svg` is the macOS tile: a 1024×1024 canvas with an 824×824 rounded body inset 100 pixels on every side. The export derives full-bleed iOS and touch icons and tightly cropped favicons from it.

Run `vp run icons:export` from the repository root to regenerate the tracked PNG and ICO assets and the development favicons in `apps/web/public`. It needs `rsvg-convert` from librsvg (`brew install librsvg`).
