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

type ToolMode = 'brush-add' | 'brush-erase' | 'lasso-add' | 'lasso-erase';
type Point = { x: number; y: number };
type OverlayCache = { canvas: HTMLCanvasElement | null; dirty: boolean; lastColor: string; lastOpacity: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const exportSizePresets = [
  { width: 1024, height: 1024, label: '1024x1024 Compact' },
  { width: 1024, height: 1536, label: '1024x1536 Tall' },
  { width: 1536, height: 1536, label: '1536x1536 Large' },
  { width: 2048, height: 2048, label: '2048x2048 Production' },
] as const;
const preferredProductionPresetLabel = '2048x2048 Production';
const partColors = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#c77dff', '#f94144', '#f3722c', '#90be6d', '#577590'];
const findPresetLabel = (width: number, height: number): string =>
  exportSizePresets.find((preset) => preset.width === width && preset.height === height)?.label ?? `Custom ${width}x${height}`;

function createRenderPlan(analysis: SpriteAnalysis, cellWidth: number, cellHeight: number, frameCount: number): RenderPlan {
  const bounds = analysis.sourceBounds;
  const sidePadding = clamp(Math.round(cellWidth * 0.05), 16, 64);
  const topPadding = clamp(Math.round(cellHeight * 0.05), 16, 64);
  const baseFloor = Math.round(cellHeight * 0.9);
  let maxMotionScale = 1;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) maxMotionScale = Math.max(maxMotionScale, idleTransform(frameIndex, frameCount).scale);
  const sourceHeightAboveFloor = Math.max(1, analysis.floorY - bounds.y + 1);
  const usableWidth = Math.max(1, cellWidth - sidePadding * 2);
  const usableHeightAboveFloor = Math.max(1, baseFloor - topPadding);
  const horizontalFitScale = usableWidth / Math.max(1, bounds.width * maxMotionScale);
  const verticalFitScale = usableHeightAboveFloor / Math.max(1, sourceHeightAboveFloor * maxMotionScale);
  const renderScale = clamp(Math.min(1, horizontalFitScale, verticalFitScale), 0.05, 1);
  const bleedRisk = bounds.width * renderScale * maxMotionScale > cellWidth || sourceHeightAboveFloor * renderScale * maxMotionScale > baseFloor;
  const warnings: string[] = [];
  if (renderScale < 0.999) warnings.push(`Auto-fit scaled source to ${(renderScale * 100).toFixed(1)}% so the full sprite fits in each cell.`);
  if (renderScale <= 0.55) warnings.push('Source is much taller than the selected cell. Consider a 1536 or 2048 cell height for a larger production strip.');
  if (bleedRisk) warnings.push('Bleed risk remains after fitting. Increase cell width/height before export.');
  return { baseFloor, renderScale, maxMotionScale, sidePadding, topPadding, bleedRisk, warnings };
}

const getCanvasPointFromPointerEvent = (evt: PointerEvent, canvas: HTMLCanvasElement): Point => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left) * (canvas.width / rect.width),
    y: (evt.clientY - rect.top) * (canvas.height / rect.height),
  };
};

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
  let activePart: string = defaultPartNames[0];
  let toolMode: ToolMode = 'brush-add';
  // Brush size is interpreted in source-image pixels.
  let brushSize = 24;
  let overlayOpacity = 0.45;
  let isPainting = false;
  let activePointerId: number | null = null;
  let lastPaintPoint: Point | null = null;
  let hoverPoint: Point | null = null;
  let renderRaf: number | null = null;
  let lassoPoints: Point[] = [];
  let undoMaskAction: (() => void) | null = null;

  root.innerHTML = `
    <h1>Sprite Rig Lab</h1>
    <div class="grid">
      <section class="panel">
        <label>Upload transparent PNG sprite</label>
        <input id="file" type="file" accept="image/png" />
        <button id="saveProject" disabled>Save Project JSON</button>
        <label>Load Project JSON</label><input id="loadProject" type="file" accept="application/json" />
        <p class="status" id="status">Waiting for PNG upload.</p>
      </section>
      <section class="panel">
        <h3>Manual Mask Editor</h3>
        <h3>Workspace</h3><canvas id="workspace" width="1024" height="1024"></canvas>
        <div class="mobileDock" id="mobileDock">
          <div class="partChips" id="partChips"></div>
          <div class="row segmented toolModes">
            <button id="brushAddMode" type="button">Brush Add</button><button id="brushEraseMode" type="button">Brush Erase</button>
            <button id="lassoAddMode" type="button">Lasso Add</button><button id="lassoEraseMode" type="button">Lasso Erase</button>
          </div>
          <div class="row"><button id="cancelLasso" type="button" disabled>Cancel Lasso</button><button id="undoMaskAction" type="button" disabled>Undo Last Mask Action</button></div>
          <div class="compactSlider"><label for="brushSize">Brush <span id="brushSizeValue">24</span></label><input id="brushSize" type="range" min="1" max="256" value="24" /></div>
          <div class="compactSlider"><label for="overlayOpacity">Overlay <span id="overlayOpacityValue">45%</span></label><input id="overlayOpacity" type="range" min="0.05" max="1" step="0.05" value="0.45" /></div>
        </div>
        <div class="layerRow"><span>Layer</span><div class="row"><button id="partUp" type="button">Up</button><button id="partDown" type="button">Down</button></div></div>
        <h3>Preview loop</h3><canvas id="preview" width="1024" height="1024"></canvas>
      </section>
    </div>`;

  const workspace = root.querySelector<HTMLCanvasElement>('#workspace')!;
  const preview = root.querySelector<HTMLCanvasElement>('#preview')!;
  void preview;
  const meta = document.createElement('pre');
  const renderReport = document.createElement('pre');
  const sourceQuality = document.createElement('pre');
  const warnings = document.createElement('p');
  void meta; void renderReport; void sourceQuality; void warnings;
  const status = root.querySelector<HTMLParagraphElement>('#status')!;
  const generateButton = document.createElement('button');
  const pngButton = document.createElement('button');
  const jsonButton = document.createElement('button');
  const saveProjectButton = root.querySelector<HTMLButtonElement>('#saveProject')!;

  const partChips = root.querySelector<HTMLDivElement>('#partChips')!;
  const partUpButton = root.querySelector<HTMLButtonElement>('#partUp')!;
  const partDownButton = root.querySelector<HTMLButtonElement>('#partDown')!;
  const brushAddModeButton = root.querySelector<HTMLButtonElement>('#brushAddMode')!;
  const brushEraseModeButton = root.querySelector<HTMLButtonElement>('#brushEraseMode')!;
  const lassoAddModeButton = root.querySelector<HTMLButtonElement>('#lassoAddMode')!;
  const lassoEraseModeButton = root.querySelector<HTMLButtonElement>('#lassoEraseMode')!;
  const cancelLassoButton = root.querySelector<HTMLButtonElement>('#cancelLasso')!;
  const undoMaskActionButton = root.querySelector<HTMLButtonElement>('#undoMaskAction')!;
  const brushSizeValue = root.querySelector<HTMLSpanElement>('#brushSizeValue')!;
  const overlayOpacityValue = root.querySelector<HTMLSpanElement>('#overlayOpacityValue')!;

  const workspaceTransform = { offsetX: 0, offsetY: 0, scale: 1 };
  const parts: MaskPart[] = defaultPartNames.map((name, i) => ({ name, visible: true, color: partColors[i % partColors.length], maskCanvas: null }));
  const overlayCache = new Map<string, OverlayCache>();

  const setStatus = (m: string, e = false) => { status.textContent = m; status.classList.toggle('error', e); };
  const ensureMaskCanvases = () => {
    if (!state.analysis) return;
    for (const part of parts) {
      if (!part.maskCanvas) {
        part.maskCanvas = document.createElement('canvas');
        part.maskCanvas.width = state.analysis.width;
        part.maskCanvas.height = state.analysis.height;
      }
      if (!overlayCache.has(part.name)) overlayCache.set(part.name, { canvas: null, dirty: true, lastColor: part.color, lastOpacity: overlayOpacity });
    }
  };
  const markPartDirty = (name: string) => { const entry = overlayCache.get(name); if (entry) entry.dirty = true; };
  const scheduleWorkspaceRender = () => {
    if (renderRaf !== null) return;
    renderRaf = requestAnimationFrame(() => { renderRaf = null; renderWorkspace(); });
  };

  const sourcePointFromEvent = (evt: PointerEvent): Point | null => {
    if (!state.analysis) return null;
    const canvasPoint = getCanvasPointFromPointerEvent(evt, workspace);
    const sourceX = Math.round((canvasPoint.x - workspaceTransform.offsetX) / workspaceTransform.scale);
    const sourceY = Math.round((canvasPoint.y - workspaceTransform.offsetY) / workspaceTransform.scale);
    return { x: clamp(sourceX, 0, state.analysis.width - 1), y: clamp(sourceY, 0, state.analysis.height - 1) };
  };

  const renderPartsPanel = () => {
    partChips.innerHTML = parts.map((p) => `<button type="button" class="partChip ${p.name === activePart ? 'active' : ''}" data-part="${p.name}"><span class="swatch" style="background:${p.color}"></span><span class="partName">${p.name}</span><span class="eyeButton" data-toggle-vis="${p.name}" role="button" aria-label="${p.visible ? 'Hide' : 'Show'} ${p.name}">${p.visible ? '👁' : '🚫'}</span></button>`).join('');
    brushAddModeButton.classList.toggle('active', toolMode === 'brush-add');
    brushEraseModeButton.classList.toggle('active', toolMode === 'brush-erase');
    lassoAddModeButton.classList.toggle('active', toolMode === 'lasso-add');
    lassoEraseModeButton.classList.toggle('active', toolMode === 'lasso-erase');
    cancelLassoButton.disabled = lassoPoints.length === 0;
    undoMaskActionButton.disabled = !undoMaskAction;
    brushSizeValue.textContent = String(brushSize);
    overlayOpacityValue.textContent = `${Math.round(overlayOpacity * 100)}%`;
  };

  const rebuildOverlay = (part: MaskPart, entry: OverlayCache) => {
    if (!part.maskCanvas) return;
    if (!entry.canvas) { entry.canvas = document.createElement('canvas'); }
    entry.canvas.width = part.maskCanvas.width;
    entry.canvas.height = part.maskCanvas.height;
    const src = part.maskCanvas.getContext('2d')!.getImageData(0, 0, part.maskCanvas.width, part.maskCanvas.height);
    const out = entry.canvas.getContext('2d')!.createImageData(src.width, src.height);
    const rgb = part.color.match(/[a-f\d]{2}/gi)?.map((v) => Number.parseInt(v, 16)) ?? [255, 0, 255];
    for (let i = 0; i < src.data.length; i += 4) {
      if (src.data[i + 3] > 0) { out.data[i] = rgb[0]; out.data[i + 1] = rgb[1]; out.data[i + 2] = rgb[2]; out.data[i + 3] = Math.round(overlayOpacity * 255); }
    }
    entry.canvas.getContext('2d')!.putImageData(out, 0, 0);
    entry.dirty = false;
    entry.lastColor = part.color;
    entry.lastOpacity = overlayOpacity;
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
    workspaceTransform.offsetX = offsetX; workspaceTransform.offsetY = offsetY; workspaceTransform.scale = scale;
    ctx.drawImage(image, offsetX, offsetY, drawW, drawH);
    for (const part of parts) {
      if (!part.visible || !part.maskCanvas) continue;
      const entry = overlayCache.get(part.name)!;
      if (entry.dirty || entry.lastColor !== part.color || entry.lastOpacity !== overlayOpacity) rebuildOverlay(part, entry);
      if (entry.canvas) ctx.drawImage(entry.canvas, offsetX, offsetY, drawW, drawH);
    }
    if (toolMode.startsWith('brush-') && hoverPoint) {
      const brushRadiusOnWorkspace = brushSize * workspaceTransform.scale;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(workspaceTransform.offsetX + hoverPoint.x * workspaceTransform.scale, workspaceTransform.offsetY + hoverPoint.y * workspaceTransform.scale, brushRadiusOnWorkspace, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (lassoPoints.length > 0) {
      const active = parts.find((p) => p.name === activePart);
      ctx.strokeStyle = active?.color ?? '#9fd7ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const first = lassoPoints[0]!;
      ctx.moveTo(workspaceTransform.offsetX + first.x * workspaceTransform.scale, workspaceTransform.offsetY + first.y * workspaceTransform.scale);
      for (let i = 1; i < lassoPoints.length; i++) {
        const point = lassoPoints[i]!;
        ctx.lineTo(workspaceTransform.offsetX + point.x * workspaceTransform.scale, workspaceTransform.offsetY + point.y * workspaceTransform.scale);
      }
      ctx.stroke();
    }
  };

  const snapshotPartMask = (part: MaskPart): ImageData | null => {
    if (!part.maskCanvas) return null;
    const ctx = part.maskCanvas.getContext('2d')!;
    return ctx.getImageData(0, 0, part.maskCanvas.width, part.maskCanvas.height);
  };
  const restorePartMask = (part: MaskPart, imageData: ImageData) => {
    if (!part.maskCanvas) return;
    part.maskCanvas.getContext('2d')!.putImageData(imageData, 0, 0);
    markPartDirty(part.name);
    scheduleWorkspaceRender();
  };
  const paintStroke = (from: Point, to: Point) => {
    const part = parts.find((p) => p.name === activePart);
    if (!part?.maskCanvas) return;
    if (!undoMaskAction && lastPaintPoint === from) {
      const before = snapshotPartMask(part);
      if (before) undoMaskAction = () => restorePartMask(part, before);
    }
    const ctx = part.maskCanvas.getContext('2d')!;
    ctx.globalCompositeOperation = toolMode === 'brush-add' ? 'source-over' : 'destination-out';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brushSize * 2;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(to.x, to.y, brushSize, 0, Math.PI * 2); ctx.fill();
    markPartDirty(part.name);
  };
  const commitLasso = () => {
    const part = parts.find((p) => p.name === activePart);
    if (!part?.maskCanvas || lassoPoints.length < 3) { lassoPoints = []; renderPartsPanel(); scheduleWorkspaceRender(); return; }
    const before = snapshotPartMask(part);
    const ctx = part.maskCanvas.getContext('2d')!;
    ctx.globalCompositeOperation = toolMode === 'lasso-add' ? 'source-over' : 'destination-out';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(lassoPoints[0]!.x, lassoPoints[0]!.y);
    for (let i = 1; i < lassoPoints.length; i++) ctx.lineTo(lassoPoints[i]!.x, lassoPoints[i]!.y);
    ctx.closePath();
    ctx.fill();
    if (before) undoMaskAction = () => restorePartMask(part, before);
    lassoPoints = [];
    markPartDirty(part.name);
    renderPartsPanel();
    scheduleWorkspaceRender();
  };

  const finishPaint = (evt: PointerEvent) => {
    if (activePointerId !== evt.pointerId) return;
    evt.preventDefault();
    workspace.releasePointerCapture(evt.pointerId);
    if (toolMode.startsWith('lasso-')) commitLasso();
    isPainting = false; activePointerId = null; lastPaintPoint = null;
  };

  workspace.addEventListener('pointerdown', (evt) => {
    if (!image || !state.analysis) return;
    evt.preventDefault();
    workspace.setPointerCapture(evt.pointerId);
    isPainting = true; activePointerId = evt.pointerId;
    const point = sourcePointFromEvent(evt); if (!point) return;
    hoverPoint = point; lastPaintPoint = point;
    if (toolMode.startsWith('brush-')) paintStroke(point, point);
    if (toolMode.startsWith('lasso-')) lassoPoints = [point];
    scheduleWorkspaceRender();
  });
  workspace.addEventListener('pointermove', (evt) => {
    const point = sourcePointFromEvent(evt); if (!point) return;
    hoverPoint = point;
    if (isPainting && activePointerId === evt.pointerId && lastPaintPoint) {
      evt.preventDefault();
      if (toolMode.startsWith('brush-')) {
        paintStroke(lastPaintPoint, point);
        lastPaintPoint = point;
      } else {
        lassoPoints.push(point);
      }
    }
    scheduleWorkspaceRender();
  });
  workspace.addEventListener('pointerup', finishPaint);
  workspace.addEventListener('pointercancel', finishPaint);
  workspace.addEventListener('pointerleave', (evt) => { if (!isPainting) { hoverPoint = null; scheduleWorkspaceRender(); } else { finishPaint(evt); } });

  root.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    image = await loadPngFromFile(file);
    sourceImageDataUrl = await new Promise<string>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(file); });
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image, 0, 0);
    state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0, 0, c.width, c.height));
    ensureMaskCanvases(); renderPartsPanel(); scheduleWorkspaceRender(); setStatus(`Loaded ${file.name}: ${state.analysis.width} x ${state.analysis.height}.`);
  });

  partChips.addEventListener('click', (e) => {
    const toggle = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle-vis]');
    if (toggle) {
      e.stopPropagation();
      const p = parts.find((part) => part.name === toggle.dataset.toggleVis);
      if (p) { p.visible = !p.visible; renderPartsPanel(); scheduleWorkspaceRender(); }
      return;
    }
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-part]'); if (!button) return;
    activePart = button.dataset.part!; renderPartsPanel(); scheduleWorkspaceRender();
  });
  partUpButton.addEventListener('click', () => { const i = parts.findIndex((p) => p.name === activePart); if (i > 0) { [parts[i - 1], parts[i]] = [parts[i], parts[i - 1]]; renderPartsPanel(); scheduleWorkspaceRender(); } });
  partDownButton.addEventListener('click', () => { const i = parts.findIndex((p) => p.name === activePart); if (i >= 0 && i < parts.length - 1) { [parts[i + 1], parts[i]] = [parts[i], parts[i + 1]]; renderPartsPanel(); scheduleWorkspaceRender(); } });
  brushAddModeButton.addEventListener('click', () => { toolMode = 'brush-add'; renderPartsPanel(); scheduleWorkspaceRender(); });
  brushEraseModeButton.addEventListener('click', () => { toolMode = 'brush-erase'; renderPartsPanel(); scheduleWorkspaceRender(); });
  lassoAddModeButton.addEventListener('click', () => { toolMode = 'lasso-add'; renderPartsPanel(); scheduleWorkspaceRender(); });
  lassoEraseModeButton.addEventListener('click', () => { toolMode = 'lasso-erase'; renderPartsPanel(); scheduleWorkspaceRender(); });
  cancelLassoButton.addEventListener('click', () => { lassoPoints = []; isPainting = false; activePointerId = null; lastPaintPoint = null; renderPartsPanel(); scheduleWorkspaceRender(); });
  undoMaskActionButton.addEventListener('click', () => { if (!undoMaskAction) return; undoMaskAction(); undoMaskAction = null; renderPartsPanel(); });
  root.querySelector<HTMLInputElement>('#brushSize')!.addEventListener('input', (e) => { brushSize = Number((e.target as HTMLInputElement).value); renderPartsPanel(); scheduleWorkspaceRender(); });
  root.querySelector<HTMLInputElement>('#overlayOpacity')!.addEventListener('input', (e) => { overlayOpacity = Number((e.target as HTMLInputElement).value); for (const p of parts) markPartDirty(p.name); renderPartsPanel(); scheduleWorkspaceRender(); });

  saveProjectButton.addEventListener('click', () => {
    if (!state.analysis || !sourceImageDataUrl) return;
    const project: ProjectSaveData = { sourceImageDataUrl, sourceImageWidth: state.analysis.width, sourceImageHeight: state.analysis.height, sourceBounds: state.analysis.sourceBounds, floorY: state.analysis.floorY, parts: parts.map((p) => ({ name: p.name, visible: p.visible, color: p.color, maskDataUrl: p.maskCanvas?.toDataURL('image/png') ?? null })), layerOrder: parts.map((p) => p.name), exportSettings: { frameCount: state.frameCount, cellWidth: state.cellWidth, cellHeight: state.cellHeight, selectedPresetLabel, recommendedPresetLabel, recommendedCellWidth, recommendedCellHeight } };
    downloadBlob('sprite-rig-project.json', new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
  });

  root.querySelector<HTMLInputElement>('#loadProject')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    const parsed = JSON.parse(await file.text()) as ProjectSaveData;
    sourceImageDataUrl = parsed.sourceImageDataUrl;
    image = await loadPngFromFile(new File([await (await fetch(parsed.sourceImageDataUrl)).blob()], 'project.png', { type: 'image/png' }));
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image, 0, 0);
    state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0, 0, c.width, c.height));
    for (const part of parts) { part.maskCanvas = document.createElement('canvas'); part.maskCanvas.width = state.analysis.width; part.maskCanvas.height = state.analysis.height; markPartDirty(part.name); }
    for (const saved of parsed.parts) { const p = parts.find((x) => x.name === saved.name); if (!p) continue; p.visible = saved.visible; if (saved.maskDataUrl && p.maskCanvas) { const m = await loadPngFromFile(new File([await (await fetch(saved.maskDataUrl)).blob()], `${p.name}.png`, { type: 'image/png' })); p.maskCanvas.getContext('2d')!.drawImage(m, 0, 0); markPartDirty(p.name); } }
    renderPartsPanel(); scheduleWorkspaceRender(); setStatus('Loaded project JSON.');
  });

  renderPartsPanel();
}
