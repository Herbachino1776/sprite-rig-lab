# Current Milestone

Milestone 1-2 baseline: deterministic upload/analyze/generate/export app.

Current export sizing behavior:
- Manual cell width and height inputs remain editable and immediately affect generation sizing.
- Preset buttons are available for:
  - 1024x1024 Compact
  - 1024x1536 Tall
  - 1536x1536 Large
  - 2048x2048 Compact/Legacy
  - 3072x3072 Production (Recommended)
  - 4096x4096 Extreme Motion
- Clicking a preset updates cell dimensions immediately and resets generated strip/export state.
- Source analysis now shows a visible “Recommended preset” line.
- Global default/recommended preset is 3072x3072 Production (Recommended) for whole-sprite idle, part-based idle, part-based walk, and part-based attack.
- 2048x2048 Compact/Legacy and 4096x4096 Extreme Motion remain manual overrides.
- Metadata JSON now includes selected and recommended preset details:
  - selectedPresetLabel
  - recommendedPresetLabel
  - recommendedCellWidth
  - recommendedCellHeight

Source quality diagnostics added before strip generation:
- Source Quality panel reports pass/warn/fail checks for:
  - transparent PNG verification
  - source image dimensions
  - alpha bounds
  - alpha-bound edge contact (left/right/top/bottom)
  - corner artifact pixels
  - likely full-canvas background/pad
  - non-transparent bounds occupancy percentage
  - recrop recommendation before animation
- Warnings are emitted when:
  - alpha bounds touch any image edge
  - source bounds area is more than 90% of image area
  - corner pixels are non-transparent
- Metadata JSON now includes `sourceQuality` diagnostics.


Manual Mask Editor v1 added:
- Default part set with independent visibility and layer order controls.
- Paint/erase brush workflows over workspace sprite with adjustable brush size and overlay opacity.
- Per-part masks are stored at source-image resolution and serialized in Save/Load Project JSON.
- Save Project JSON now captures source dimensions, sourceBounds, floorY, parts, layer order, visibility, serialized masks, and export settings.

- Mobile stabilization pass: mask painting must disable text selection/callouts, support pointer capture/cancel flows, and keep touch drawing accurate on iPhone-class browsers.
- Workspace pointer coordinates must be converted from CSS pixels to backing canvas pixels before workspaceTransform mapping.
- Mask editor UI must expose touch-friendly part chips (>=44px controls) with color/name/visibility and mobile-first layout above workspace on narrow screens.
- Overlay redraws must use cached tinted mask canvases with dirty-flag invalidation and requestAnimationFrame-throttled workspace rendering.

- App shell invariant: Generate Strip, Export PNG Strip, Export Metadata JSON, workspace canvas, preview canvas, and part chips must always remain mounted in DOM.
- Mask/editor changes must not remove or disable deterministic strip export pipeline or preview loop.
- Mobile UI invariant: primary touch controls are 44px+ (target 48px) and workspace remains visually prioritized near top on narrow screens.
