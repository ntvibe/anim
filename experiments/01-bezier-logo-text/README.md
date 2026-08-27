# 01 — Bézier logo + text

A minimal browser motion tool for testing a reusable animation workflow.

## What it does

- Upload a local logo image.
- Edit headline and font family.
- Define one cubic Bézier easing curve.
- Map the shared eased progress to separate logo and text motion recipes.
- Scrub or play the animation.
- Export an animated GIF using the exact same Canvas renderer as the preview.

## Run

Serve the repository with any static web server, or enable GitHub Pages for the repository root.

The experiment itself has no build step. GIF encoding imports [`gifenc`](https://github.com/mattdesl/gifenc) from unpkg at runtime.

## Next useful experiments

- Visual draggable Bézier handles.
- Multiple reusable animation presets stored as JSON.
- SVG/logo placement and anchor controls.
- Per-layer start/end property inspector.
- PNG sequence / WebM export for higher quality than GIF.
