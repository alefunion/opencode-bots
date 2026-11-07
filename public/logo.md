# Bots for OpenCode — icon notes

The mark is a square speech bubble that doubles as a small robot: two open eyes over a shaded band, standing on two one-stroke feet: two open eyes over a shaded band. It follows the construction of the OpenCode logo, so it sits naturally next to OpenCode without copying it.

- **Grid.** 5 × 5 strokes. The outline, each foot, the bar between the eyes, each eye, and the shaded band are all exactly one stroke, the same rule as the OpenCode logo (one stroke is a quarter of its 4-stroke width).
- **Tones.** OpenCode's single ink at full strength for the outline and a lower opacity for the inner shade, with the eyes left open like the logo's counter. Light backgrounds: `#1F1F1F`, shade at 20%. Dark backgrounds: `#EEEEEE`, shade at 28%. The app icon uses the dark tones on `#0B0B0B`, with the shade flattened to `#4B4B4B`.
- **Whole pixels.** Scale in steps of 5 × 5px (35px in the app, 20px strokes at 192px, 56px at 512px) so every edge lands on a pixel. Smallest legible size: 15 × 15px.
- **Clear space.** At least two strokes on every side. In the app icons the mark also stays inside the central 80% maskable circle.
- Flat geometry only: no colour, gradients, drop shadows, glows, or outlines. No lettering, and no OpenCode O-frame or wordmark, so it does not suggest Anomaly made or endorses it.

Files: `mark-light.svg` (dark mark for light backgrounds), `mark-dark.svg` (light mark for dark backgrounds), `mark.svg` (switches with the system theme, used as the favicon), `logo.svg` (512px app icon). Rebuild the PNGs with `scripts/build-icons.sh`.
