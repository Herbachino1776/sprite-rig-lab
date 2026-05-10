import { analyzeAlpha, type SpriteAnalysis } from './image/alphaAnalysis';
import { loadPngFromFile } from './image/loadImage';
import { idleTransform } from './motion/idlePreset';
import { downloadBlob } from './export/exporters';
import { defaultState } from './state/projectState';

type RenderPlan = {
  baseFloor: number;
  renderScale: number;
  maxMotionScale: number;
  sidePadding: number;
  topPadding: number;
  bleedRisk: boolean;
  warnings: string[];
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const exportSizePresets = [
  { width: 1024, height: 1024, label: '1024x1024 Compact' },
  { width: 1024, height: 1536, label: '1024x1536 Tall' },
  { width: 1536, height: 1536, label: '1536x1536 Large' },
  { width: 2048, height: 2048, label: '2048x2048 Production' },
] as const;
const preferredProductionPresetLabel = '2048x2048 Production';
const findPresetLabel = (width: number, height: number): string =>
  exportSizePresets.find((preset) => preset.width === width && preset.height === height)?.label ?? `Custom ${width}x${height}`;

function createRenderPlan(analysis: SpriteAnalysis, cellWidth: number, cellHeight: number, frameCount: number): RenderPlan {
  const bounds = analysis.sourceBounds;
  const sidePadding = clamp(Math.round(cellWidth * 0.05), 16, 64);
  const topPadding = clamp(Math.round(cellHeight * 0.05), 16, 64);
  const baseFloor = Math.round(cellHeight * 0.9);

  let maxMotionScale = 1;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    maxMotionScale = Math.max(maxMotionScale, idleTransform(frameIndex, frameCount).scale);
  }

  const sourceHeightAboveFloor = Math.max(1, analysis.floorY - bounds.y + 1);
  const usableWidth = Math.max(1, cellWidth - sidePadding * 2);
  const usableHeightAboveFloor = Math.max(1, baseFloor - topPadding);
  const horizontalFitScale = usableWidth / Math.max(1, bounds.width * maxMotionScale);
  const verticalFitScale = usableHeightAboveFloor / Math.max(1, sourceHeightAboveFloor * maxMotionScale);
  const renderScale = clamp(Math.min(1, horizontalFitScale, verticalFitScale), 0.05, 1);

  const maxRenderedWidth = bounds.width * renderScale * maxMotionScale;
  const maxRenderedHeightAboveFloor = sourceHeightAboveFloor * renderScale * maxMotionScale;
  const bleedRisk = maxRenderedWidth > cellWidth || maxRenderedHeightAboveFloor > baseFloor;
  const warnings: string[] = [];

  if (renderScale < 0.999) {
    warnings.push(`Auto-fit scaled source to ${(renderScale * 100).toFixed(1)}% so the full sprite fits in each cell.`);
  }

  if (renderScale <= 0.55) {
    warnings.push('Source is much taller than the selected cell. Consider a 1536 or 2048 cell height for a larger production strip.');
  }

  if (bleedRisk) {
    warnings.push('Bleed risk remains after fitting. Increase cell width/height before export.');
  }

  return {
    baseFloor,
    renderScale,
    maxMotionScale,
    sidePadding,
    topPadding,
    bleedRisk,
    warnings,
  };
}

export function initApp(root: HTMLDivElement) {
  const state = { ...defaultState };
  let image: HTMLImageElement | null = null;
  let stripCanvas: HTMLCanvasElement | null = null;
  let lastRenderPlan: RenderPlan | null = null;
  let selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight);
  let recommendedPresetLabel = preferredProductionPresetLabel;
  let recommendedCellWidth = 2048;
  let recommendedCellHeight = 2048;
  let previewAnimationId: number | null = null;
  let previewTimeoutId: number | null = null;

  root.innerHTML = `
    <h1>Sprite Rig Lab</h1>
    <div class="grid">
      <section class="panel">
        <label>Upload transparent PNG sprite</label>
        <input id="file" type="file" accept="image/png" />
        <p class="status" id="status">Waiting for PNG upload.</p>
        <div class="row">
          <div><label>Frame count</label><select id="frameCount"><option value="5">5</option><option value="6" selected>6</option></select></div>
          <div><label>Cell width</label><input id="cellW" type="number" min="16" value="1024" /></div>
          <div><label>Cell height</label><input id="cellH" type="number" min="16" value="1024" /></div>
        </div>
        <label>Export size presets</label>
        <div class="presetRow" id="exportPresets">
          ${exportSizePresets
            .map((preset) => `<button type="button" data-preset="${preset.width}x${preset.height}" data-preset-label="${preset.label}">${preset.label}</button>`)
            .join('')}
        </div>
        <button id="generate" disabled>Generate strip</button>
        <button id="png" disabled>Export PNG strip</button>
        <button id="json" disabled>Export metadata JSON</button>
        <h3>Export report</h3>
        <pre id="renderReport">No strip generated yet.</pre>
        <h3>Source analysis</h3>
        <pre id="meta">No sprite loaded yet.</pre>
        <h3>Source quality</h3>
        <pre id="sourceQuality">No sprite loaded yet.</pre>
        <p class="warn" id="warnings"></p>
      </section>
      <section class="panel">
        <h3>Workspace</h3>
        <canvas id="workspace" width="1024" height="1024"></canvas>
        <h3>Preview loop</h3>
        <canvas id="preview" width="1024" height="1024"></canvas>
      </section>
    </div>`;

  const workspace = root.querySelector<HTMLCanvasElement>('#workspace')!;
  const preview = root.querySelector<HTMLCanvasElement>('#preview')!;
  const meta = root.querySelector<HTMLPreElement>('#meta')!;
  const renderReport = root.querySelector<HTMLPreElement>('#renderReport')!;
  const warnings = root.querySelector<HTMLParagraphElement>('#warnings')!;
  const sourceQuality = root.querySelector<HTMLPreElement>('#sourceQuality')!;
  const status = root.querySelector<HTMLParagraphElement>('#status')!;
  const generateButton = root.querySelector<HTMLButtonElement>('#generate')!;
  const pngButton = root.querySelector<HTMLButtonElement>('#png')!;
  const jsonButton = root.querySelector<HTMLButtonElement>('#json')!;
  const cellWidthInput = root.querySelector<HTMLInputElement>('#cellW')!;
  const cellHeightInput = root.querySelector<HTMLInputElement>('#cellH')!;

  const setStatus = (message: string, isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
  };

  const setExportReady = (ready: boolean) => {
    pngButton.disabled = !ready;
    jsonButton.disabled = !ready;
  };

  const resetPreviewLoop = () => {
    if (previewAnimationId !== null) cancelAnimationFrame(previewAnimationId);
    if (previewTimeoutId !== null) window.clearTimeout(previewTimeoutId);
    previewAnimationId = null;
    previewTimeoutId = null;
  };

  const clearCanvas = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const resetStripState = () => {
    stripCanvas = null;
    lastRenderPlan = null;
    setExportReady(false);
    resetPreviewLoop();
    clearCanvas(preview);
    renderReport.textContent = 'No strip generated yet.';
  };

  const renderWorkspace = () => {
    const ctx = workspace.getContext('2d')!;
    ctx.clearRect(0, 0, workspace.width, workspace.height);
    if (!image || !state.analysis) return;

    const scale = Math.min(workspace.width / image.width, workspace.height / image.height, 1);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const offsetX = (workspace.width - drawW) / 2;
    const offsetY = (workspace.height - drawH) / 2;
    ctx.drawImage(image, offsetX, offsetY, drawW, drawH);

    const b = state.analysis.sourceBounds;
    ctx.strokeStyle = '#4dd0e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(offsetX + b.x * scale, offsetY + b.y * scale, b.width * scale, b.height * scale);

    const floorY = offsetY + state.analysis.floorY * scale;
    ctx.strokeStyle = '#f4a261';
    ctx.beginPath();
    ctx.moveTo(0, floorY);
    ctx.lineTo(workspace.width, floorY);
    ctx.stroke();
  };

  const generateStrip = () => {
    if (!image || !state.analysis) {
      setStatus('Upload a PNG before generating a strip.', true);
      return;
    }

    const frameCount = state.frameCount;
    const cellWidth = state.cellWidth;
    const cellHeight = state.cellHeight;
    const out = document.createElement('canvas');
    out.width = frameCount * cellWidth;
    out.height = cellHeight;
    const ctx = out.getContext('2d')!;
    ctx.clearRect(0, 0, out.width, out.height);

    const bounds = state.analysis.sourceBounds;
    const renderPlan = createRenderPlan(state.analysis, cellWidth, cellHeight, frameCount);

    for (let i = 0; i < frameCount; i++) {
      const tr = idleTransform(i, frameCount);
      const totalScale = renderPlan.renderScale * tr.scale;
      const scaledBoundsW = bounds.width * totalScale;
      const frameCenterX = i * cellWidth + cellWidth / 2;
      const x = frameCenterX - scaledBoundsW / 2 - bounds.x * totalScale;
      const y = renderPlan.baseFloor - state.analysis.floorY * totalScale;

      ctx.drawImage(image, x, y, image.width * totalScale, image.height * totalScale);
    }

    stripCanvas = out;
    lastRenderPlan = renderPlan;
    setExportReady(true);

    const report = {
      frameCount,
      cellWidth,
      cellHeight,
      stripWidth: out.width,
      stripHeight: out.height,
      floorY: renderPlan.baseFloor,
      renderScale: Number(renderPlan.renderScale.toFixed(4)),
      maxMotionScale: Number(renderPlan.maxMotionScale.toFixed(4)),
      sidePadding: renderPlan.sidePadding,
      topPadding: renderPlan.topPadding,
      bleedRisk: renderPlan.bleedRisk,
      warnings: renderPlan.warnings,
    };

    renderReport.textContent = JSON.stringify(report, null, 2);
    warnings.textContent = [...state.analysis.warnings, ...renderPlan.warnings].join(' | ');

    if (renderPlan.bleedRisk) {
      setStatus('Strip generated with bleed risk. Increase cell size.', true);
    } else if (renderPlan.renderScale < 0.999) {
      setStatus(`Generated fitted ${frameCount}-frame strip: ${out.width} x ${out.height}.`);
    } else {
      setStatus(`Generated ${frameCount}-frame strip: ${out.width} x ${out.height}.`);
    }

    renderPreview();
  };

  const renderPreview = () => {
    resetPreviewLoop();
    if (!stripCanvas) return;

    const ctx = preview.getContext('2d')!;
    let frame = 0;

    const tick = () => {
      if (!stripCanvas) return;
      const fw = state.cellWidth;
      const fh = state.cellHeight;
      ctx.clearRect(0, 0, preview.width, preview.height);
      ctx.drawImage(stripCanvas, frame * fw, 0, fw, fh, 0, 0, preview.width, preview.height);
      frame = (frame + 1) % state.frameCount;
      previewTimeoutId = window.setTimeout(() => {
        previewAnimationId = requestAnimationFrame(tick);
      }, 160);
    };

    tick();
  };

  root.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      setStatus(`Loading ${file.name}...`);
      warnings.textContent = '';
      meta.textContent = 'Analyzing source PNG...';
      sourceQuality.textContent = 'Analyzing source quality...';
      resetStripState();

      image = await loadPngFromFile(file);
      const c = document.createElement('canvas');
      c.width = image.naturalWidth || image.width;
      c.height = image.naturalHeight || image.height;
      c.getContext('2d')!.drawImage(image, 0, 0);
      state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0, 0, c.width, c.height));
      meta.textContent = JSON.stringify(state.analysis, null, 2);
      sourceQuality.textContent = JSON.stringify(state.analysis.sourceQuality, null, 2);
      const initialPlan = createRenderPlan(state.analysis, state.cellWidth, state.cellHeight, state.frameCount);
      const shouldRecommendProductionPreset = state.analysis.sourceBounds.height > 1024 || initialPlan.renderScale < 0.75;
      if (shouldRecommendProductionPreset) {
        recommendedPresetLabel = preferredProductionPresetLabel;
        recommendedCellWidth = 2048;
        recommendedCellHeight = 2048;
      } else {
        recommendedPresetLabel = selectedPresetLabel;
        recommendedCellWidth = state.cellWidth;
        recommendedCellHeight = state.cellHeight;
      }
      meta.textContent += `\nRecommended preset: ${recommendedPresetLabel} (${recommendedCellWidth}x${recommendedCellHeight})`;
      warnings.textContent = state.analysis.warnings.join(' | ');
      generateButton.disabled = false;
      renderWorkspace();
      setStatus(`Loaded ${file.name}: ${state.analysis.width} x ${state.analysis.height}.`);
    } catch (error) {
      image = null;
      state.analysis = null;
      generateButton.disabled = true;
      setExportReady(false);
      clearCanvas(workspace);
      clearCanvas(preview);
      meta.textContent = 'Upload failed.';
      sourceQuality.textContent = 'Upload failed.';
      renderReport.textContent = 'No strip generated yet.';
      warnings.textContent = error instanceof Error ? error.message : String(error);
      setStatus('Upload failed. See warning text below.', true);
      console.error(error);
    }
  });

  root.querySelector<HTMLSelectElement>('#frameCount')!.addEventListener('change', (e) => {
    state.frameCount = Number((e.target as HTMLSelectElement).value) as 5 | 6;
    resetStripState();
  });

  cellWidthInput.addEventListener('input', (e) => {
    state.cellWidth = Number((e.target as HTMLInputElement).value);
    selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight);
    resetStripState();
  });

  cellHeightInput.addEventListener('input', (e) => {
    state.cellHeight = Number((e.target as HTMLInputElement).value);
    selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight);
    resetStripState();
  });

  root.querySelector<HTMLDivElement>('#exportPresets')!.addEventListener('click', (e) => {
    const preset = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-preset]')?.dataset.preset;
    if (!preset) return;

    const [widthText, heightText] = preset.split('x');
    const width = Number(widthText);
    const height = Number(heightText);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;

    state.cellWidth = width;
    state.cellHeight = height;
    selectedPresetLabel = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-preset]')?.dataset.presetLabel
      ?? findPresetLabel(width, height);
    cellWidthInput.value = String(width);
    cellHeightInput.value = String(height);
    resetStripState();
  });

  generateButton.addEventListener('click', generateStrip);

  pngButton.addEventListener('click', async () => {
    if (!stripCanvas) {
      setStatus('Generate a strip before exporting PNG.', true);
      return;
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      stripCanvas!.toBlob((b) => b ? resolve(b) : reject(new Error('Could not encode strip PNG.')), 'image/png');
    });
    downloadBlob('sprite-strip.png', blob);
  });

  jsonButton.addEventListener('click', () => {
    if (!state.analysis || !lastRenderPlan) {
      setStatus('Generate a strip before exporting metadata.', true);
      return;
    }

    const metadata = {
      frameCount: state.frameCount,
      cellWidth: state.cellWidth,
      cellHeight: state.cellHeight,
      stripWidth: state.frameCount * state.cellWidth,
      stripHeight: state.cellHeight,
      floorY: lastRenderPlan.baseFloor,
      anchorX: Math.round(state.cellWidth / 2),
      renderScale: Number(lastRenderPlan.renderScale.toFixed(4)),
      maxMotionScale: Number(lastRenderPlan.maxMotionScale.toFixed(4)),
      sidePadding: lastRenderPlan.sidePadding,
      topPadding: lastRenderPlan.topPadding,
      alphaVerified: state.analysis.alphaVerified,
      sourceBounds: state.analysis.sourceBounds,
      sourceFloorY: state.analysis.floorY,
      bleedRisk: lastRenderPlan.bleedRisk,
      warnings: [...state.analysis.warnings, ...lastRenderPlan.warnings],
      selectedPresetLabel,
      recommendedPresetLabel,
      recommendedCellWidth,
      recommendedCellHeight,
      sourceQuality: state.analysis.sourceQuality,
    };
    downloadBlob('sprite-strip.json', new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }));
  });
}
