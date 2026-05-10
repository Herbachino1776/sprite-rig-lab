# Sprite Rig Lab — Executable Project Plan

**Project purpose:** Build a separate browser-based production tool that turns one transparent PNG enemy/boss sprite into clean, floor-locked, evenly spaced videogame animation sprite strips.

**Core decision:** Create a new repo, separate from `biomech-retro-horror`.

Suggested repo name: `sprite-rig-lab`

Suggested stack: **Vite + TypeScript + Canvas 2D**. Do not start with AI, SAM, backend, cloud storage, or game-repo integration. Build the deterministic strip tool first.

---

## 0. Project Doctrine

### North star

Sprite Rig Lab should make this workflow possible:

`upload one alpha PNG -> verify source -> detect bounds and floor -> rig/mask parts -> apply motion preset -> preview -> export production strip + metadata`

### Non-negotiables

- [ ] Source sprite must have a real alpha channel.
- [ ] No white, black, checkerboard, fog, floor, shadow pad, or baked background in sprite exports.
- [ ] Every strip uses equal-width cells.
- [ ] Every frame is centered inside its own cell.
- [ ] Every frame shares one floor line.
- [ ] No sprite pixels may bleed across cell boundaries.
- [ ] Export must include PNG strip and metadata JSON.
- [ ] GIF preview is preferred once the core export path is stable.
- [ ] AI is only allowed later as mask-assist or seam-repair, not as the primary animator.

### What not to build yet

- [ ] No SAM integration in the first milestone.
- [ ] No diffusion/image-generation backend in the first milestone.
- [ ] No login/accounts.
- [ ] No cloud project storage.
- [ ] No React complexity unless needed.
- [ ] No direct mutation of the game repo.

---

## 1. Master Checklist

### Milestone 0 — Repo + foundation

- [ ] Create new GitHub repo: `sprite-rig-lab`.
- [ ] Initialize Vite + TypeScript.
- [ ] Add `README.md` with project purpose and non-negotiables.
- [ ] Add `AGENTS.md` for Codex rules.
- [ ] Add `/docs/current-milestone.md`.
- [ ] Add `/docs/roadmap.md`.
- [ ] Add `/docs/technical-invariants.md`.
- [ ] App starts locally with `npm run dev`.
- [ ] App builds with `npm run build`.

### Milestone 1 — Upload, alpha verification, and source analysis

- [ ] Upload a PNG sprite in the browser.
- [ ] Draw the sprite on the workspace canvas.
- [ ] Read pixel data using `ImageData`.
- [ ] Detect whether an alpha channel exists.
- [ ] Detect non-transparent alpha bounds.
- [ ] Detect bottom-most non-transparent pixel as initial `floorY`.
- [ ] Show source bounds box.
- [ ] Show floor guide line.
- [ ] Show source metadata panel.
- [ ] Display warnings for likely bad source images.

Acceptance test:

- [ ] Uploading a valid transparent PNG displays source bounds and floor line correctly.
- [ ] Uploading a bad/opaque image displays a visible warning.

### Milestone 2 — Deterministic strip compiler v1

- [ ] Let user choose frame count: 5 or 6.
- [ ] Let user choose cell size, default `1024 x 1024`.
- [ ] Generate an idle strip by subtly scaling/bobbing the whole sprite.
- [ ] Keep the bottom of the sprite locked to the same floor inside each cell.
- [ ] Center each frame in its cell.
- [ ] Export transparent PNG strip.
- [ ] Export metadata JSON.
- [ ] Add preview canvas that loops the generated frames.

Acceptance test:

- [ ] A 6-frame 1024-cell export produces a `6144 x 1024` PNG.
- [ ] All frames share the same floor.
- [ ] No frame crosses its cell boundary.
- [ ] Metadata JSON matches the PNG dimensions.

### Milestone 3 — Manual mask editor v1

- [ ] Add part list: torso, head, front arm, rear arm, front leg, rear leg, horn, tail, extra.
- [ ] Add brush tool for painting a mask.
- [ ] Add eraser tool.
- [ ] Add mask color overlay.
- [ ] Store each part mask separately.
- [ ] Allow layer ordering.
- [ ] Allow part visibility toggle.
- [ ] Save project JSON with masks/parts.
- [ ] Load project JSON back into the app.

Acceptance test:

- [ ] User can paint a leg mask, hide/show it, and save/load the project without losing it.

### Milestone 4 — Pivot and transform editor

- [ ] Add pivot point per body part.
- [ ] Add floor-contact point for feet or grounded body parts.
- [ ] Add manual transform controls: rotate, translate X/Y, scale X/Y.
- [ ] Render selected part around its pivot.
- [ ] Preserve layer order during rendering.
- [ ] Add onion-skin preview for previous/next frame.

Acceptance test:

- [ ] Rotating a leg around the hip pivot keeps it attached visually enough for rough preview.
- [ ] Layer order renders front/rear limbs correctly.

### Milestone 5 — Idle animation preset

- [ ] Add whole-body breathing preset.
- [ ] Add part-based idle preset.
- [ ] Add sliders: breathing amount, torso bob, head sway, arm drift.
- [ ] Keep floor lock active.
- [ ] Export idle strip using rigged parts.

Acceptance test:

- [ ] A 6-frame idle loop reads as breathing without floor jitter.

### Milestone 6 — Walk animation preset v1

- [ ] Add small-walk preset for biped sprites.
- [ ] Add sliders: stride width, leg crossing, hip sway, torso bob, arm swing, foot-lock strength.
- [ ] Add foot plant timing.
- [ ] Support front-leg/rear-leg alternating motion.
- [ ] Support wide-stance correction.
- [ ] Keep floor lock active.
- [ ] Export walk strip.

Acceptance test:

- [ ] A biped enemy produces a readable 6-frame small walk with no frame bleed and no vertical floor jitter.

### Milestone 7 — QA and export hardening

- [ ] Add alpha purity check.
- [ ] Add full-canvas opaque background warning.
- [ ] Add corner artifact detector.
- [ ] Add frame-boundary bleed detector.
- [ ] Add floor jitter detector.
- [ ] Add oversized-cell safety margin report.
- [ ] Add export report.
- [ ] Block export or warn loudly on major failures.

Acceptance test:

- [ ] The app reports exact frame/cell dimensions and flags bleed risk before export.

### Milestone 8 — Project-specific export presets

- [ ] Add preset: The Outer Engine enemy idle, 6 frames, 1024-cell.
- [ ] Add preset: The Outer Engine enemy walk, 6 frames, 1024-cell.
- [ ] Add preset: The Outer Engine boss idle, 6 frames, larger cell option.
- [ ] Add filename builder.
- [ ] Add metadata fields: anchorX, floorY, frameCount, cellWidth, cellHeight, stripWidth, stripHeight.
- [ ] Add optional Phaser-friendly JSON output.

Acceptance test:

- [ ] Export names and metadata are usable by the game pipeline without manual reformatting.

### Milestone 9 — Advanced assist features, only after core works

- [ ] Add click-assisted mask refinement.
- [ ] Evaluate SAM or SAM-like local sidecar for segmentation.
- [ ] Add seam-repair mask generation.
- [ ] Evaluate local AI cleanup only inside repair masks.
- [ ] Add before/after seam repair comparison.
- [ ] Keep deterministic rig and motion system as the source of truth.

Acceptance test:

- [ ] AI assistance improves masks or seams without redesigning the creature.

---

## 2. Repo Structure

```text
sprite-rig-lab/
  README.md
  AGENTS.md
  package.json
  index.html
  src/
    main.ts
    app.ts
    styles.css
    canvas/
      workspaceCanvas.ts
      previewCanvas.ts
      stripCanvas.ts
    image/
      loadImage.ts
      alphaAnalysis.ts
      bounds.ts
    rig/
      rigTypes.ts
      parts.ts
      masks.ts
      pivots.ts
      transforms.ts
    motion/
      idlePreset.ts
      walkPreset.ts
      keyframes.ts
    export/
      exportPng.ts
      exportJson.ts
      exportReport.ts
    qa/
      alphaChecks.ts
      bleedChecks.ts
      floorChecks.ts
      dimensionChecks.ts
    state/
      projectState.ts
      undoRedo.ts
  docs/
    current-milestone.md
    roadmap.md
    technical-invariants.md
    export-contract.md
```

---

## 3. Core Data Shapes

```ts
type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type SpriteAnalysis = {
  width: number;
  height: number;
  hasAlpha: boolean;
  alphaVerified: boolean;
  sourceBounds: Rect;
  floorY: number;
  opaquePixelCount: number;
  warnings: string[];
};

type RigPart = {
  id: string;
  name: string;
  role: "torso" | "head" | "arm" | "leg" | "horn" | "tail" | "extra";
  layerIndex: number;
  visible: boolean;
  pivot: Point;
  floorContact?: Point;
  maskDataUrl?: string;
};

type MotionKeyframe = {
  frameIndex: number;
  partId: string;
  translateX: number;
  translateY: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
};

type ExportMetadata = {
  frameCount: number;
  cellWidth: number;
  cellHeight: number;
  stripWidth: number;
  stripHeight: number;
  floorY: number;
  anchorX: number;
  alphaVerified: boolean;
  bleedRisk: boolean;
  sourceBounds: Rect;
};
```

---

## 4. First Codex Prompt

Use this as the first prompt after creating the repo:

```text
Create a Vite + TypeScript browser app for a new repo called sprite-rig-lab.

Goal:
Build the first deterministic prototype of a sprite-strip animation tool.

Requirements:
- Single-page app.
- No backend.
- No AI integration.
- No React unless necessary.
- Use Canvas 2D.
- Upload a transparent PNG sprite.
- Draw it on a workspace canvas.
- Detect non-transparent alpha bounds using ImageData.
- Verify whether the source appears to have real alpha.
- Show the detected bounding box.
- Show a horizontal floor guide based on the bottom-most non-transparent pixel.
- Let the user choose frame count: 5 or 6.
- Let the user choose cell size, default 1024 x 1024.
- Generate a simple idle animation strip by subtly scaling/bobbing the whole sprite across frames.
- Center each frame inside equal-width cells.
- Lock the bottom of the sprite to the same floor Y in every frame.
- Export a transparent PNG strip.
- Export a JSON metadata file with frameCount, cellWidth, cellHeight, stripWidth, stripHeight, floorY, alphaVerified, sourceBounds, and bleedRisk.
- Add a simple preview canvas showing the generated animation loop.
- Keep code modular using folders for image analysis, canvas rendering, motion, export, QA, and state.
- Add README.md, AGENTS.md, docs/current-milestone.md, docs/roadmap.md, and docs/technical-invariants.md.

Acceptance:
- npm install works.
- npm run dev works.
- npm run build works.
- A 6-frame export at 1024 x 1024 cells produces a 6144 x 1024 transparent PNG strip.
- Metadata JSON dimensions match the exported PNG.
- Source bounds and floor guide are visible after upload.

Do not add SAM, diffusion, seam repair, cloud storage, auth, or game repo integration in this PR.
```

---

## 5. AGENTS.md Draft

```text
# AGENTS.md — Sprite Rig Lab

This repo is a production tool for generating videogame sprite strips from transparent PNG sprites.

Rules:
- Keep changes surgical and testable.
- Preserve deterministic export behavior.
- Do not add AI, SAM, backend services, auth, or cloud storage unless the current milestone explicitly asks for it.
- Every export must preserve real alpha transparency.
- Every strip must use equal-width cells.
- Every frame must be centered inside its own cell.
- Every frame must share a consistent floor line.
- Do not allow sprite pixels to bleed across cell boundaries.
- Prefer Canvas 2D and TypeScript modules.
- Keep source analysis, rigging, motion, QA, and export code separated.
- Update docs when changing export behavior or technical invariants.

Required checks before PR completion:
- npm run build
- Manual upload/export test with one transparent PNG
- Confirm metadata matches exported strip dimensions
```

---

## 6. Definition of Done for the First PR

The first PR is done only when:

- [ ] Repo has a working Vite + TypeScript app.
- [ ] Transparent PNG upload works.
- [ ] Source sprite renders to canvas.
- [ ] Alpha bounds are detected.
- [ ] Floor guide is shown.
- [ ] User can generate a simple 5-frame or 6-frame idle strip.
- [ ] User can export PNG strip.
- [ ] User can export metadata JSON.
- [ ] App builds successfully.
- [ ] README and docs explain the current limitations.

---

## 7. Immediate Next Action

Do this first:

- [ ] Create the repo `sprite-rig-lab`.
- [ ] Add the first Codex prompt above.
- [ ] Ask Codex to create a PR.
- [ ] Review the app locally.
- [ ] Test with one known-good transparent PNG enemy sprite.
- [ ] Check whether the strip export dimensions and floor lock are correct.

After that, the next milestone is manual masks. Do not jump to AI seam repair until the deterministic compiler is stable.
