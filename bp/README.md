# Bitpanda lockup animator

Browser-based recreation of the Bitpanda lockup motion reference.

- Exact supplied Bitpanda wordmark SVG.
- B logo uses the working AE → Lottie vector export (frames 0–50 at 25 fps).
- Wordmark slides behind the B without fading.
- Custom text slides out from behind the B without fading.
- Independent cubic Bézier controls for wordmark motion, text motion, and layout recentering.
- Controls for text, text size, tracking, gap, B animation speed, holds, transition durations, and portal overlap.
- Exposes `window.bitpandaLockup` for programmatic control.

Open through GitHub Pages at `/anim/bp/`.
