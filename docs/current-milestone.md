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
