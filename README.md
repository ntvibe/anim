# anim

Small browser-based motion experiments for replacing repetitive After Effects tasks.

## Experiments

- [`bp`](./bp/) — Bitpanda lockup animator using the AE-derived vector B animation, exact supplied wordmark SVG, masked wordmark/custom-text transitions, timing controls, and independent cubic Bézier curves.
- [`01-bezier-logo-text`](./experiments/01-bezier-logo-text/) — deterministic Canvas animation with one shared cubic Bézier curve, separate logo/text motion recipes, live preview, and GIF export.

## Philosophy

- Browser-first: no install or build step for individual experiments.
- Deterministic: preview and export use the same renderer.
- Small experiments: each experiment lives in its own subfolder.
- Practical controls only: avoid turning this into a full After Effects clone.

For GitHub Pages, use the repository root as the site source and open the experiment from the landing page.
