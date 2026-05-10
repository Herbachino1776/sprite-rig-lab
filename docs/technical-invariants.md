# Technical Invariants

- Export strips must remain transparent PNG.
- Cells are fixed-size and evenly spaced.
- Sprite floor alignment is consistent across frames.
- Metadata dimensions must match export dimensions.
- Export size presets must set cell width/height deterministically and preserve floor-lock rendering behavior.
- Source analysis must include a visible recommended preset line.
- Recommended preset is 2048x2048 Production when sourceBounds.height > 1024 or when computed renderScale < 0.75 for current settings.
- Metadata JSON must include preset selection/recommendation fields alongside existing export geometry fields.
