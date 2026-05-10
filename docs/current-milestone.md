# Current Milestone

Milestone 1-2 baseline: deterministic upload/analyze/generate/export app.

Current export sizing behavior:
- Manual cell width and height inputs remain editable and immediately affect generation sizing.
- Preset buttons are available for:
  - 1024x1024 Compact
  - 1024x1536 Tall
  - 1536x1536 Large
  - 2048x2048 Production
- Clicking a preset updates cell dimensions immediately and resets generated strip/export state.
- Source analysis now shows a visible “Recommended preset” line.
- Recommendation logic promotes 2048x2048 Production when:
  - source bounds height is greater than 1024, or
  - computed render scale for current settings would be below 0.75.
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
