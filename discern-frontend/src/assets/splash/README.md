# Launch screen

`splash.png` — 860×1864, RGB, no alpha. Wired in `app.config.js` under
`ios.splash` with `resizeMode: "cover"` and `backgroundColor: "#17110C"`.

## It is frame 0 of the brand moment, not a separate picture

The static launch screen is the icon's **shaft with no crossbar yet** — light
already falling, nothing in it. Once the JS bundle loads, our own animation
starts from exactly these pixels and draws the crossbar out of the beam, so the
icon somebody just tapped does not reappear, it opens.

That is also why frame 0 has to be a finished image on its own. On a slow cold
start it is what somebody looks at for a second and a half; a beam down a dark
frame survives that, a half-drawn cross does not.

## Three things not to "tidy"

1. **The wordmark is painted into the PNG.** A storyboard cannot use a font
   that is not bundled, and anything the name does at the handoff — moving,
   fading, arriving — is a flicker on every cold start.
2. **The shaft is blurred, not layered.** Drawn with straight sides it is a
   painted stripe, and over 850 points of height that reads as a road rather
   than as light. Stacking three narrower copies to fake a falloff was tried
   and was worse: three hard edges instead of one, banding down the frame.
3. **`ios.splash` is the legacy key on purpose.** `getIosSplashConfig` in
   `@expo/prebuild-config` sets `enableFullScreenImage_legacy: true` for it,
   which is what makes the art fill the screen. The newer plugin path centres a
   200pt logo instead.

## Regenerating

    node design/render-splash.js

Slices `splashPaint()` out of `design/discern-shell.html`, renders frame 0 in
headless Chrome (loading Fraunces from Google Fonts — this step needs network),
and writes the PNG here. The design canvas is the source of truth; there is no
second copy of the art.
