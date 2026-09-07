# App icon — "the light, shaped as a cross"

Three 1024×1024 PNGs, one per iOS 18 appearance. Wired in `app.config.js` under
`ios.icon`; `icon-light.png` is also the top-level `icon` fallback.

| file | appearance | ground |
| --- | --- | --- |
| `icon-light.png` | default, and what the App Store listing shows | warm dark, `#2A1F16 → #150F0A` |
| `icon-dark.png` | system dark | deeper, `#1B130C → #080604`, light down ~15% |
| `icon-tinted.png` | system tinted | true black, solid white cross, hard edges |

## These are generated, not hand-drawn

The source of truth is `drawA()` in `design/discern-shell.html` (boards S04,
S07, S07a, S07b). To regenerate after changing it:

    node design/render-icon.js

That script slices the drawing functions out of the shell, renders each
appearance at 1024 in headless Chrome, and writes the three PNGs here.

## Three things not to "tidy"

1. **The crossbar is as bright as the shaft.** One step dimmer and the icon is
   a beam with something near it, not a cross.
2. **The crossbar's top and bottom edges are soft; its ends fade; nothing is
   blurred as a whole.** Filled flat it becomes a plank — four hard edges is a
   lit object, not light. Blurred whole it becomes a lens flare with no
   crossbar in it. Both were drawn before this one; see board S07a.
3. **The tinted ground is true black.** Tinted is a luminance map, not a colour
   swap: anything above black lifts the whole tile to grey once the system tint
   lands. The tinted variant is drawn rather than derived because a grayscale
   conversion of the light art has no edges to survive with.

Expo's `withIosIcons` removes transparency from the light and tinted variants
and flattens them onto solid white; the dark variant keeps it. All three of
these are fully opaque, so that flatten never fires.
