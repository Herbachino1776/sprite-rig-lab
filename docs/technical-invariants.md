# Technical Invariants

- Export strips must remain transparent PNG.
- Cells are fixed-size and evenly spaced.
- Sprite floor alignment is consistent across frames.
- Metadata dimensions must match export dimensions.
- Export size presets must set cell width/height deterministically and preserve floor-lock rendering behavior.
- Source analysis must include a visible recommended preset line.
- Recommended preset is 2048x2048 Production when sourceBounds.height > 1024 or when computed renderScale < 0.75 for current settings.
- Metadata JSON must include preset selection/recommendation fields alongside existing export geometry fields.
- Source quality diagnostics must expose deterministic pass/warn/fail status for alpha verification, dimensions, bounds, edge-touch, corner artifacts, full-canvas pad risk, occupancy %, and recrop recommendation.
- Source analysis warnings must include edge-touch (left/right/top/bottom), corner artifact, and occupancy >90% checks.
- Metadata JSON must include `sourceQuality` diagnostics alongside existing analysis and export fields.

- Manual mask data must be stored per part at source-image resolution and must survive Save/Load Project JSON round-trips.
- Manual mask editor must expose deterministic default parts, visibility toggles, layer reorder, paint/erase brush modes, brush size, and overlay opacity without changing export floor-lock behavior.

- Manual mask editor pointer mapping invariant: map pointer client coordinates -> canvas backing coordinates -> source-image coordinates with transform-aware clamping.
- Manual mask editor mobile invariant: workspace drawing must prevent default touch/callout behavior and must handle pointercapture + pointercancel without stuck paint state.
- Manual mask editor performance invariant: tinted mask overlays are cacheable per part and may only rebuild when mask/color/opacity changes.
