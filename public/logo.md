# Bots for OpenCode — icon notes

The mark is a small robot face in a thick frame: two eyes over a shaded band, inside a window cut into a solid block.

- **Grid.** 16 × 20 units. The frame is 4 units thick, the window 8 × 12, each eye 2 × 4, and the shaded band fills the lower 8 units of the window.
- **Tones.** Light backgrounds: `#000000` mark, shade in the same black at 17.6% opacity (`#D2D2D2` on white). Dark backgrounds: `#FFFFFF` mark, shade in the same white at 29.4% opacity (`#4B4B4B` on black). Keep three decimals so the shade lands exactly on those greys.
- **Whole pixels.** Scale in whole steps (16 × 20px, 32 × 40px, …) so every edge lands on a pixel: 32 × 40px in the app. Smallest legible size: 16 × 20px. The favicon centres the mark on a 20 × 20 square.
- **App icon.** Measured from OpenCode's own iOS app icon (`packages/desktop/icons/prod/ios/AppIcon-512@2x.png` in anomalyco/opencode, which its web app serves as the apple-touch-icon), on the same 1024 canvas:
  - Mark at x 231–791, y 162–862: 16 × 20 units of 35px, so the window interior is 280 × 420 at (371, 302), exactly where OpenCode's is.
  - Background: a full square with a vertical gradient, `#343434` to `#181818`. No rounded corners: iOS and Android apply their own mask.
  - Frame: lit from above, `#FFFFFF` to `#B2B2B2`.
  - Shadow: a black rectangle 10px wider on each side and 48px longer below than the frame, blurred 7px across and 28px down.
  - Window: a dark well (`#010101` to `#292929`) above one shaded square, the mark's 8 × 8 grey band, `#525250` turning olive `#1E1808` at the bottom, with darker side walls. OpenCode's ledge and inset band are left out, so it reads as a single square as in the flat mark.
  - Eyes: the frame's material and lighting at their own size, with a small shadow below.
  - No edge highlights or bevel lines on any shape: on the Home Screen, iOS draws its own. OpenCode's grain texture is left out too: it disappears at Home Screen sizes.
  - The same file serves as the maskable icon, as OpenCode's does.
- Outside the app icon, flat geometry only: no colour, gradients, drop shadows, glows, or outlines. No lettering, and no OpenCode O-frame or wordmark, so it does not suggest Anomaly made or endorses it.

Files: `mark-light.svg` (dark mark for light backgrounds), `mark-dark.svg` (light mark for dark backgrounds), `mark.svg` (switches with the system theme, source of the favicon), `logo.svg` (1024px app icon, drawn by hand). `scripts/build-icons.sh` compresses the SVGs with SVGO and renders the favicon and the PNGs.
