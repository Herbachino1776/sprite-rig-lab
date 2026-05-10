import { analyzeAlpha, type SpriteAnalysis } from './image/alphaAnalysis';
import { loadPngFromFile } from './image/loadImage';
import { idleTransform } from './motion/idlePreset';
import { downloadBlob } from './export/exporters';
import { defaultState, defaultPartNames, type MaskPart, type ProjectSaveData } from './state/projectState';

type RenderPlan = {
  baseFloor: number;
  renderScale: number;
  maxMotionScale: number;
  sidePadding: number;
  topPadding: number;
  bleedRisk: boolean;
  warnings: string[];
};

type BrushMode = 'paint' | 'erase';

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

  if (renderScale < 0.999) warnings.push(`Auto-fit scaled source to ${(renderScale * 100).toFixed(1)}% so the full sprite fits in each cell.`);
  if (renderScale <= 0.55) warnings.push('Source is much taller than the selected cell. Consider a 1536 or 2048 cell height for a larger production strip.');
  if (bleedRisk) warnings.push('Bleed risk remains after fitting. Increase cell width/height before export.');

  return { baseFloor, renderScale, maxMotionScale, sidePadding, topPadding, bleedRisk, warnings };
}

const partColors = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#c77dff', '#f94144', '#f3722c', '#90be6d', '#577590'];

export function initApp(root: HTMLDivElement) {
  const state = { ...defaultState };
  let image: HTMLImageElement | null = null;
  let stripCanvas: HTMLCanvasElement | null = null;
  let sourceImageDataUrl: string | null = null;
  let lastRenderPlan: RenderPlan | null = null;
  let selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight);
  let recommendedPresetLabel = preferredProductionPresetLabel;
  let recommendedCellWidth = 2048;
  let recommendedCellHeight = 2048;
  let previewAnimationId: number | null = null;
  let previewTimeoutId: number | null = null;
  let activePart: string = defaultPartNames[0];
  let brushMode: BrushMode = 'paint';
  let brushSize = 24;
  let overlayOpacity = 0.45;
  let isPainting = false;

  root.innerHTML = `...`;
  root.innerHTML = `
    <h1>Sprite Rig Lab</h1>
    <div class="grid">
      <section class="panel">
        <label>Upload transparent PNG sprite</label>
        <input id="file" type="file" accept="image/png" />
        <button id="saveProject" disabled>Save Project JSON</button>
        <label>Load Project JSON</label>
        <input id="loadProject" type="file" accept="application/json" />
        <p class="status" id="status">Waiting for PNG upload.</p>
        <div class="row">
          <div><label>Frame count</label><select id="frameCount"><option value="5">5</option><option value="6" selected>6</option></select></div>
          <div><label>Cell width</label><input id="cellW" type="number" min="16" value="1024" /></div>
          <div><label>Cell height</label><input id="cellH" type="number" min="16" value="1024" /></div>
        </div>
        <label>Export size presets</label>
        <div class="presetRow" id="exportPresets">${exportSizePresets.map((preset) => `<button type="button" data-preset="${preset.width}x${preset.height}" data-preset-label="${preset.label}">${preset.label}</button>`).join('')}</div>
        <button id="generate" disabled>Generate strip</button>
        <button id="png" disabled>Export PNG strip</button>
        <button id="json" disabled>Export metadata JSON</button>
        <h3>Export report</h3><pre id="renderReport">No strip generated yet.</pre>
        <h3>Source analysis</h3><pre id="meta">No sprite loaded yet.</pre>
        <h3>Source quality</h3><pre id="sourceQuality">No sprite loaded yet.</pre>
        <p class="warn" id="warnings"></p>
      </section>
      <section class="panel">
        <h3>Manual Mask Editor</h3>
        <label>Active part</label><select id="activePart"></select>
        <div class="row"><button id="partUp" type="button">Move Part Up</button><button id="partDown" type="button">Move Part Down</button></div>
        <label>Brush mode</label><div class="row"><button id="paintMode" type="button">Paint Mask</button><button id="eraseMode" type="button">Erase Mask</button></div>
        <label>Brush size</label><input id="brushSize" type="range" min="1" max="256" value="24" />
        <label>Overlay opacity</label><input id="overlayOpacity" type="range" min="0.05" max="1" step="0.05" value="0.45" />
        <div id="partsList" class="partsList"></div>
        <h3>Workspace</h3><canvas id="workspace" width="1024" height="1024"></canvas>
        <h3>Preview loop</h3><canvas id="preview" width="1024" height="1024"></canvas>
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
  const saveProjectButton = root.querySelector<HTMLButtonElement>('#saveProject')!;

  const activePartSelect = root.querySelector<HTMLSelectElement>('#activePart')!;
  const partsList = root.querySelector<HTMLDivElement>('#partsList')!;
  const partUpButton = root.querySelector<HTMLButtonElement>('#partUp')!;
  const partDownButton = root.querySelector<HTMLButtonElement>('#partDown')!;
  const paintModeButton = root.querySelector<HTMLButtonElement>('#paintMode')!;
  const eraseModeButton = root.querySelector<HTMLButtonElement>('#eraseMode')!;

  const workspaceTransform = { offsetX: 0, offsetY: 0, scale: 1 };
  const parts: MaskPart[] = defaultPartNames.map((name, i) => ({ name, visible: true, color: partColors[i % partColors.length], maskCanvas: null }));

  const setStatus = (m: string, e = false) => { status.textContent = m; status.classList.toggle('error', e); };
  const setExportReady = (ready: boolean) => { pngButton.disabled = !ready; jsonButton.disabled = !ready; };
  const setProjectReady = (ready: boolean) => { saveProjectButton.disabled = !ready; };
  const clearCanvas = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
  const ensureMaskCanvases = () => {
    if (!state.analysis) return;
    for (const part of parts) {
      if (!part.maskCanvas) {
        part.maskCanvas = document.createElement('canvas');
        part.maskCanvas.width = state.analysis.width;
        part.maskCanvas.height = state.analysis.height;
      }
    }
  };

  const renderPartsPanel = () => {
    activePartSelect.innerHTML = parts.map((p) => `<option value="${p.name}">${p.name}</option>`).join('');
    activePartSelect.value = activePart;
    partsList.innerHTML = parts.map((p, idx) => `<label class="partItem"><input type="checkbox" data-vis="${p.name}" ${p.visible ? 'checked' : ''}/> <span class="swatch" style="background:${p.color}"></span>${idx + 1}. ${p.name}</label>`).join('');
  };

  const renderWorkspace = () => {
    const ctx = workspace.getContext('2d')!;
    ctx.clearRect(0, 0, workspace.width, workspace.height);
    if (!image || !state.analysis) return;
    ensureMaskCanvases();

    const scale = Math.min(workspace.width / image.width, workspace.height / image.height, 1);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const offsetX = (workspace.width - drawW) / 2;
    const offsetY = (workspace.height - drawH) / 2;
    workspaceTransform.offsetX = offsetX;
    workspaceTransform.offsetY = offsetY;
    workspaceTransform.scale = scale;

    ctx.drawImage(image, offsetX, offsetY, drawW, drawH);

    for (const part of parts) {
      if (!part.visible || !part.maskCanvas) continue;
      const maskCtx = part.maskCanvas.getContext('2d')!;
      const data = maskCtx.getImageData(0, 0, part.maskCanvas.width, part.maskCanvas.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > 0) {
          const rgb = part.color.match(/[a-f\d]{2}/gi)?.map((v) => Number.parseInt(v, 16)) ?? [255, 0, 255];
          px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = Math.round(overlayOpacity * 255);
        }
      }
      const overlay = document.createElement('canvas');
      overlay.width = part.maskCanvas.width; overlay.height = part.maskCanvas.height;
      overlay.getContext('2d')!.putImageData(data, 0, 0);
      ctx.drawImage(overlay, offsetX, offsetY, drawW, drawH);
    }
  };

  const paintAt = (evt: PointerEvent) => {
    if (!state.analysis) return;
    const part = parts.find((p) => p.name === activePart);
    if (!part?.maskCanvas) return;
    const rect = workspace.getBoundingClientRect();
    const localX = evt.clientX - rect.left;
    const localY = evt.clientY - rect.top;
    const sourceX = Math.round((localX - workspaceTransform.offsetX) / workspaceTransform.scale);
    const sourceY = Math.round((localY - workspaceTransform.offsetY) / workspaceTransform.scale);
    if (sourceX < 0 || sourceY < 0 || sourceX >= state.analysis.width || sourceY >= state.analysis.height) return;
    const ctx = part.maskCanvas.getContext('2d')!;
    ctx.globalCompositeOperation = brushMode === 'paint' ? 'source-over' : 'destination-out';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sourceX, sourceY, brushSize, 0, Math.PI * 2);
    ctx.fill();
    renderWorkspace();
  };

  workspace.addEventListener('pointerdown', (evt) => { if (!image) return; isPainting = true; paintAt(evt); });
  workspace.addEventListener('pointermove', (evt) => { if (isPainting) paintAt(evt); });
  window.addEventListener('pointerup', () => { isPainting = false; });

  // keep remaining existing handlers concise
  root.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    image = await loadPngFromFile(file);
    sourceImageDataUrl = await new Promise<string>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(file); });
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image, 0, 0);
    state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0, 0, c.width, c.height));
    meta.textContent = JSON.stringify(state.analysis, null, 2);
    sourceQuality.textContent = JSON.stringify(state.analysis.sourceQuality, null, 2);
    generateButton.disabled = false; setProjectReady(true); ensureMaskCanvases(); renderWorkspace(); renderPartsPanel(); setStatus(`Loaded ${file.name}: ${state.analysis.width} x ${state.analysis.height}.`);
  });

  activePartSelect.addEventListener('change', (e) => { activePart = (e.target as HTMLSelectElement).value; });
  partsList.addEventListener('change', (e) => { const el = e.target as HTMLInputElement; const name = el.dataset.vis; const p = parts.find((part) => part.name === name); if (p) { p.visible = el.checked; renderWorkspace(); } });
  partUpButton.addEventListener('click', () => { const i = parts.findIndex((p) => p.name === activePart); if (i > 0) { [parts[i - 1], parts[i]] = [parts[i], parts[i - 1]]; renderPartsPanel(); renderWorkspace(); } });
  partDownButton.addEventListener('click', () => { const i = parts.findIndex((p) => p.name === activePart); if (i >= 0 && i < parts.length - 1) { [parts[i + 1], parts[i]] = [parts[i], parts[i + 1]]; renderPartsPanel(); renderWorkspace(); } });
  paintModeButton.addEventListener('click', () => { brushMode = 'paint'; });
  eraseModeButton.addEventListener('click', () => { brushMode = 'erase'; });
  root.querySelector<HTMLInputElement>('#brushSize')!.addEventListener('input', (e) => { brushSize = Number((e.target as HTMLInputElement).value); });
  root.querySelector<HTMLInputElement>('#overlayOpacity')!.addEventListener('input', (e) => { overlayOpacity = Number((e.target as HTMLInputElement).value); renderWorkspace(); });

  // Existing generation/export handlers remain
  root.querySelector<HTMLButtonElement>('#generate')!.addEventListener('click', () => {
    if (!image || !state.analysis) return;
    const out = document.createElement('canvas'); out.width = state.frameCount * state.cellWidth; out.height = state.cellHeight;
    const ctx = out.getContext('2d')!; const bounds = state.analysis.sourceBounds; const plan = createRenderPlan(state.analysis, state.cellWidth, state.cellHeight, state.frameCount);
    for (let i = 0; i < state.frameCount; i++) { const tr = idleTransform(i, state.frameCount); const totalScale = plan.renderScale * tr.scale; const scaledBoundsW = bounds.width * totalScale; const x = i * state.cellWidth + state.cellWidth / 2 - scaledBoundsW / 2 - bounds.x * totalScale; const y = plan.baseFloor - state.analysis.floorY * totalScale; ctx.drawImage(image, x, y, image.width * totalScale, image.height * totalScale); }
    stripCanvas = out; lastRenderPlan = plan; setExportReady(true); renderReport.textContent = JSON.stringify({ frameCount: state.frameCount, cellWidth: state.cellWidth, cellHeight: state.cellHeight }, null, 2);
  });

  pngButton.addEventListener('click', async () => { if (!stripCanvas) return; const blob = await new Promise<Blob>((resolve, reject) => stripCanvas!.toBlob((b) => b ? resolve(b) : reject(new Error('Could not encode strip PNG.')), 'image/png')); downloadBlob('sprite-strip.png', blob); });
  jsonButton.addEventListener('click', () => { if (!state.analysis || !lastRenderPlan) return; downloadBlob('sprite-strip.json', new Blob([JSON.stringify({ sourceBounds: state.analysis.sourceBounds, sourceFloorY: state.analysis.floorY }, null, 2)], { type: 'application/json' })); });

  saveProjectButton.addEventListener('click', () => {
    if (!state.analysis || !sourceImageDataUrl) return;
    const project: ProjectSaveData = {
      sourceImageDataUrl,
      sourceImageWidth: state.analysis.width,
      sourceImageHeight: state.analysis.height,
      sourceBounds: state.analysis.sourceBounds,
      floorY: state.analysis.floorY,
      parts: parts.map((p) => ({ name: p.name, visible: p.visible, color: p.color, maskDataUrl: p.maskCanvas?.toDataURL('image/png') ?? null })),
      layerOrder: parts.map((p) => p.name),
      exportSettings: { frameCount: state.frameCount, cellWidth: state.cellWidth, cellHeight: state.cellHeight, selectedPresetLabel, recommendedPresetLabel, recommendedCellWidth, recommendedCellHeight },
    };
    downloadBlob('sprite-rig-project.json', new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
  });

  root.querySelector<HTMLInputElement>('#loadProject')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    const parsed = JSON.parse(await file.text()) as ProjectSaveData;
    sourceImageDataUrl = parsed.sourceImageDataUrl;
    image = await loadPngFromFile(new File([await (await fetch(parsed.sourceImageDataUrl)).blob()], 'project.png', { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image, 0, 0);
    state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0, 0, c.width, c.height));
    for (const part of parts) part.maskCanvas = document.createElement('canvas');
    for (const p of parts) { p.maskCanvas!.width = state.analysis.width; p.maskCanvas!.height = state.analysis.height; }
    for (const saved of parsed.parts) {
      const p = parts.find((x) => x.name === saved.name); if (!p) continue; p.visible = saved.visible;
      if (saved.maskDataUrl && p.maskCanvas) { const m = await loadPngFromFile(new File([await (await fetch(saved.maskDataUrl)).blob()], `${p.name}.png`, { type: 'image/png' })); p.maskCanvas.getContext('2d')!.drawImage(m, 0, 0); }
    }
    setProjectReady(true); generateButton.disabled = false; renderPartsPanel(); renderWorkspace(); setStatus('Loaded project JSON.');
  });

  renderPartsPanel();
}
