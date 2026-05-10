import { analyzeAlpha, type SpriteAnalysis } from './image/alphaAnalysis';
import { loadPngFromFile } from './image/loadImage';
import { idleTransform } from './motion/idlePreset';
import { downloadBlob } from './export/exporters';
import { defaultState, defaultPartNames, type MaskPart, type ProjectSaveData } from './state/projectState';

type RenderPlan = { baseFloor: number; renderScale: number; maxMotionScale: number; sidePadding: number; topPadding: number; bleedRisk: boolean; warnings: string[] };
type ToolMode = 'brush-add' | 'brush-erase' | 'lasso-add' | 'lasso-erase';
type Point = { x: number; y: number };
type OverlayCache = { canvas: HTMLCanvasElement | null; dirty: boolean; lastColor: string; lastOpacity: number };
type ExportMeta = { frameCount: number; cellWidth: number; cellHeight: number; stripWidth: number; stripHeight: number; floorY: number; renderScale: number; selectedPreset: string; warnings: string[]; bleedRisk: boolean };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const exportSizePresets = [
  { width: 1024, height: 1024, label: '1024x1024 Compact' },
  { width: 1024, height: 1536, label: '1024x1536 Tall' },
  { width: 1536, height: 1536, label: '1536x1536 Large' },
  { width: 2048, height: 2048, label: '2048x2048 Production' },
] as const;
const preferredProductionPresetLabel = '2048x2048 Production';
const partColors = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#c77dff', '#f94144', '#f3722c', '#90be6d', '#577590'];
const findPresetLabel = (width: number, height: number): string => exportSizePresets.find((preset) => preset.width === width && preset.height === height)?.label ?? `Custom ${width}x${height}`;

const getCanvasPointFromPointerEvent = (evt: PointerEvent, canvas: HTMLCanvasElement): Point => {
  const rect = canvas.getBoundingClientRect();
  return { x: (evt.clientX - rect.left) * (canvas.width / rect.width), y: (evt.clientY - rect.top) * (canvas.height / rect.height) };
};

function createRenderPlan(analysis: SpriteAnalysis, cellWidth: number, cellHeight: number, frameCount: number): RenderPlan {
  const bounds = analysis.sourceBounds;
  const sidePadding = clamp(Math.round(cellWidth * 0.05), 16, 64);
  const topPadding = clamp(Math.round(cellHeight * 0.05), 16, 64);
  const baseFloor = Math.round(cellHeight * 0.9);
  let maxMotionScale = 1;
  for (let i = 0; i < frameCount; i++) maxMotionScale = Math.max(maxMotionScale, idleTransform(i, frameCount).scale);
  const sourceHeightAboveFloor = Math.max(1, analysis.floorY - bounds.y + 1);
  const renderScale = clamp(Math.min(1, (cellWidth - sidePadding * 2) / Math.max(1, bounds.width * maxMotionScale), (baseFloor - topPadding) / Math.max(1, sourceHeightAboveFloor * maxMotionScale)), 0.05, 1);
  const bleedRisk = bounds.width * renderScale * maxMotionScale > cellWidth || sourceHeightAboveFloor * renderScale * maxMotionScale > baseFloor;
  const warnings: string[] = [];
  if (renderScale < 0.999) warnings.push(`Auto-fit scaled source to ${(renderScale * 100).toFixed(1)}%.`);
  if (renderScale <= 0.55) warnings.push('Source is very tall for this cell height.');
  if (bleedRisk) warnings.push('Bleed risk remains after fitting.');
  return { baseFloor, renderScale, maxMotionScale, sidePadding, topPadding, bleedRisk, warnings };
}

export function initApp(root: HTMLDivElement) {
  const state = { ...defaultState };
  let image: HTMLImageElement | null = null;
  let sourceImageDataUrl: string | null = null;
  let stripCanvas: HTMLCanvasElement | null = null;
  let lastRenderPlan: RenderPlan | null = null;
  let selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight);
  let recommendedPresetLabel = preferredProductionPresetLabel;
  let recommendedCellWidth = 2048;
  let recommendedCellHeight = 2048;
  let exportMeta: ExportMeta | null = null;
  let stalePreview = true;

  let activePart = defaultPartNames[0] as string;
  let toolMode: ToolMode = 'brush-add';
  let brushSize = 24;
  let overlayOpacity = 0.45;
  let isPainting = false;
  let activePointerId: number | null = null;
  let lastPaintPoint: Point | null = null;
  let hoverPoint: Point | null = null;
  let lassoPoints: Point[] = [];
  let undoMaskAction: (() => void) | null = null;
  let renderRaf: number | null = null;
  let previewRaf: number | null = null;

  root.innerHTML = `<div class="shell"><header class="topBar panel"><div><h1>Sprite Rig Lab</h1><p id="status" class="status">Waiting for PNG upload.</p></div><div class="fileBox"><label for="file">Upload PNG</label><input id="file" type="file" accept="image/png" /></div></header>
  <main class="workspaceArea panel"><canvas id="workspace" width="1024" height="1024"></canvas></main>
  <section class="toolDock" id="mobileDock"><div class="partChips" id="partChips"></div>
  <div class="segmented toolModes"><button id="brushAddMode" type="button">Brush Add</button><button id="brushEraseMode" type="button">Brush Erase</button><button id="lassoAddMode" type="button">Lasso Add</button><button id="lassoEraseMode" type="button">Lasso Erase</button></div>
  <div class="row"><button id="undoMaskAction" type="button" disabled>Undo</button><button id="cancelLasso" type="button" disabled>Cancel Lasso</button></div>
  <div class="compactSlider"><label for="brushSize">Brush <span id="brushSizeValue">24</span></label><input id="brushSize" type="range" min="1" max="256" value="24" /></div>
  <div class="compactSlider"><label for="overlayOpacity">Overlay <span id="overlayOpacityValue">45%</span></label><input id="overlayOpacity" type="range" min="0.05" max="1" step="0.05" value="0.45" /></div></section>
  <section class="panel stack"><details open><summary>Export & Preview</summary><div class="controls"><div class="row"><label>Frames<select id="frameCount"><option value="5">5</option><option value="6" selected>6</option></select></label><label>Cell W<input id="cellWidth" type="number" min="64" step="64" value="1024" /></label><label>Cell H<input id="cellHeight" type="number" min="64" step="64" value="1024" /></label></div><div class="presetRow" id="presetRow"></div><div class="row"><button id="generateButton" class="primary">Generate Strip</button><button id="pngButton">Export PNG Strip</button><button id="jsonButton">Export Metadata JSON</button></div><canvas id="preview" width="1024" height="1024"></canvas><pre id="renderReport"></pre></div></details>
  <details><summary>Source Analysis</summary><pre id="sourceQuality">No source loaded.</pre></details>
  <details><summary>Project Save/Load</summary><div class="row"><button id="saveProject" disabled>Save Project JSON</button><label class="fileLabel">Load<input id="loadProject" type="file" accept="application/json" /></label></div></details>
  <div id="shellError" class="shellError" hidden></div></section></div>`;

  const q = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const workspace = q<HTMLCanvasElement>('workspace'); const preview = q<HTMLCanvasElement>('preview');
  const status = q<HTMLParagraphElement>('status'); const renderReport = q<HTMLPreElement>('renderReport'); const sourceQuality = q<HTMLPreElement>('sourceQuality');
  const generateButton = q<HTMLButtonElement>('generateButton'); const pngButton = q<HTMLButtonElement>('pngButton'); const jsonButton = q<HTMLButtonElement>('jsonButton');
  const partChips = q<HTMLDivElement>('partChips'); const brushSizeValue = q<HTMLSpanElement>('brushSizeValue'); const overlayOpacityValue = q<HTMLSpanElement>('overlayOpacityValue');

  const workspaceTransform = { offsetX: 0, offsetY: 0, scale: 1 };
  const parts: MaskPart[] = defaultPartNames.map((name, i) => ({ name, visible: true, color: partColors[i % partColors.length], maskCanvas: null }));
  const overlayCache = new Map<string, OverlayCache>();

  const setStatus = (m: string, e = false) => { status.textContent = m; status.classList.toggle('error', e); };
  const markStale = () => { stalePreview = true; renderReport.dataset.stale = 'true'; };

  const selfCheck = () => {
    const shellError = q<HTMLDivElement>('shellError');
    const missing = ['generateButton', 'pngButton', 'jsonButton', 'workspace', 'preview', 'partChips'].filter((id) => !root.querySelector(`#${id}`));
    if (missing.length) { shellError.hidden = false; shellError.textContent = `UI shell error: missing ${missing.join(', ')}`; console.error(shellError.textContent); }
  };

  const ensureMaskCanvases = () => { if (!state.analysis) return; for (const p of parts) { if (!p.maskCanvas) { p.maskCanvas = document.createElement('canvas'); p.maskCanvas.width = state.analysis.width; p.maskCanvas.height = state.analysis.height; } if (!overlayCache.has(p.name)) overlayCache.set(p.name, { canvas: null, dirty: true, lastColor: p.color, lastOpacity: overlayOpacity }); } };
  const markPartDirty = (name: string) => { const e = overlayCache.get(name); if (e) e.dirty = true; markStale(); };

  const sourcePointFromEvent = (evt: PointerEvent): Point | null => {
    if (!state.analysis) return null;
    const p = getCanvasPointFromPointerEvent(evt, workspace);
    return { x: clamp(Math.round((p.x - workspaceTransform.offsetX) / workspaceTransform.scale), 0, state.analysis.width - 1), y: clamp(Math.round((p.y - workspaceTransform.offsetY) / workspaceTransform.scale), 0, state.analysis.height - 1) };
  };
  const scheduleWorkspaceRender = () => { if (renderRaf !== null) return; renderRaf = requestAnimationFrame(() => { renderRaf = null; renderWorkspace(); }); };

  const renderParts = () => {
    partChips.innerHTML = parts.map((p) => `<button class="partChip ${p.name === activePart ? 'active' : ''}" data-part="${p.name}"><span class="swatch" style="background:${p.color}"></span><span class="partName">${p.name}</span><span data-toggle-vis="${p.name}">${p.visible ? '👁' : '🚫'}</span></button>`).join('');
    ['brushAddMode','brushEraseMode','lassoAddMode','lassoEraseMode'].forEach((id, i) => q<HTMLButtonElement>(id).classList.toggle('active', ['brush-add','brush-erase','lasso-add','lasso-erase'][i] === toolMode));
    q<HTMLButtonElement>('cancelLasso').disabled = lassoPoints.length === 0;
    q<HTMLButtonElement>('undoMaskAction').disabled = !undoMaskAction;
    brushSizeValue.textContent = String(brushSize); overlayOpacityValue.textContent = `${Math.round(overlayOpacity * 100)}%`;
  };

  const renderWorkspace = () => { /* unchanged drawing behavior */
    const ctx = workspace.getContext('2d')!; ctx.clearRect(0, 0, workspace.width, workspace.height); if (!image || !state.analysis) return; ensureMaskCanvases();
    const scale = Math.min(workspace.width / image.width, workspace.height / image.height, 1); const drawW = image.width * scale; const drawH = image.height * scale;
    workspaceTransform.offsetX = (workspace.width - drawW) / 2; workspaceTransform.offsetY = (workspace.height - drawH) / 2; workspaceTransform.scale = scale;
    ctx.drawImage(image, workspaceTransform.offsetX, workspaceTransform.offsetY, drawW, drawH);
    for (const part of parts) { if (!part.visible || !part.maskCanvas) continue; const entry = overlayCache.get(part.name)!; if (entry.dirty) { entry.canvas = entry.canvas ?? document.createElement('canvas'); entry.canvas.width = part.maskCanvas.width; entry.canvas.height = part.maskCanvas.height; const src = part.maskCanvas.getContext('2d')!.getImageData(0,0,part.maskCanvas.width,part.maskCanvas.height); const out = entry.canvas.getContext('2d')!.createImageData(src.width, src.height); const rgb = part.color.match(/[a-f\d]{2}/gi)?.map((v) => Number.parseInt(v,16)) ?? [255,0,255]; for (let i=0;i<src.data.length;i+=4) if (src.data[i+3]>0) { out.data[i]=rgb[0]; out.data[i+1]=rgb[1]; out.data[i+2]=rgb[2]; out.data[i+3]=Math.round(overlayOpacity*255); } entry.canvas.getContext('2d')!.putImageData(out,0,0); entry.dirty = false; } if (entry.canvas) ctx.drawImage(entry.canvas, workspaceTransform.offsetX, workspaceTransform.offsetY, drawW, drawH); }
    if (lassoPoints.length) { ctx.strokeStyle = '#9fd7ff'; ctx.beginPath(); ctx.moveTo(workspaceTransform.offsetX + lassoPoints[0]!.x * workspaceTransform.scale, workspaceTransform.offsetY + lassoPoints[0]!.y * workspaceTransform.scale); for (let i=1;i<lassoPoints.length;i++) ctx.lineTo(workspaceTransform.offsetX + lassoPoints[i]!.x * workspaceTransform.scale, workspaceTransform.offsetY + lassoPoints[i]!.y * workspaceTransform.scale); ctx.stroke(); }
  };

  const compileStrip = () => {
    if (!image || !state.analysis) return;
    const plan = createRenderPlan(state.analysis, state.cellWidth, state.cellHeight, state.frameCount);
    const canvas = document.createElement('canvas'); canvas.width = state.cellWidth * state.frameCount; canvas.height = state.cellHeight;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < state.frameCount; i++) {
      const t = idleTransform(i, state.frameCount);
      const pivotX = state.analysis.sourceBounds.x + state.analysis.sourceBounds.width / 2;
      ctx.save(); ctx.translate(i * state.cellWidth + state.cellWidth / 2  , plan.baseFloor + t.bobY * plan.renderScale); ctx.scale(plan.renderScale * t.scale, plan.renderScale * t.scale); ctx.drawImage(image, -pivotX, -state.analysis.floorY); ctx.restore();
    }
    stripCanvas = canvas; lastRenderPlan = plan; stalePreview = false;
    exportMeta = { frameCount: state.frameCount, cellWidth: state.cellWidth, cellHeight: state.cellHeight, stripWidth: canvas.width, stripHeight: canvas.height, floorY: plan.baseFloor, renderScale: Number(plan.renderScale.toFixed(4)), selectedPreset: selectedPresetLabel, warnings: plan.warnings, bleedRisk: plan.bleedRisk };
    renderReport.textContent = JSON.stringify(exportMeta, null, 2);
    setStatus(`Generated strip ${canvas.width}x${canvas.height}`);
  };

  const startPreviewLoop = () => {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    let lastTs = 0; let frame = 0;
    const tick = (ts: number) => { const ctx = preview.getContext('2d')!; ctx.clearRect(0,0,preview.width,preview.height); if (stripCanvas && !stalePreview) { if (ts - lastTs > 180) { frame = (frame + 1) % state.frameCount; lastTs = ts; } const sx = frame * state.cellWidth; ctx.drawImage(stripCanvas, sx, 0, state.cellWidth, state.cellHeight, 0, 0, preview.width, preview.height); } previewRaf = requestAnimationFrame(tick); };
    previewRaf = requestAnimationFrame(tick);
  };

  q<HTMLInputElement>('file').addEventListener('change', async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; image = await loadPngFromFile(file); sourceImageDataUrl = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(file); }); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image,0,0); state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0,0,c.width,c.height)); sourceQuality.textContent = `Source: ${state.analysis.width}x${state.analysis.height}\nFloorY: ${state.analysis.floorY}`; ensureMaskCanvases(); renderParts(); scheduleWorkspaceRender(); markStale(); setStatus(`Loaded ${file.name}`); q<HTMLButtonElement>('saveProject').disabled = false; });

  generateButton.addEventListener('click', compileStrip);
  pngButton.addEventListener('click', () => { if (!stripCanvas) return; stripCanvas.toBlob((blob) => blob && downloadBlob('sprite-strip.png', blob)); });
  jsonButton.addEventListener('click', () => { if (!exportMeta) return; downloadBlob('sprite-strip-metadata.json', new Blob([JSON.stringify(exportMeta, null, 2)], { type: 'application/json' })); });

  q<HTMLSelectElement>('frameCount').addEventListener('change', (e) => { state.frameCount = Number((e.target as HTMLSelectElement).value) as 5 | 6; markStale(); });
  q<HTMLInputElement>('cellWidth').addEventListener('input', (e) => { state.cellWidth = Number((e.target as HTMLInputElement).value); selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight); markStale(); });
  q<HTMLInputElement>('cellHeight').addEventListener('input', (e) => { state.cellHeight = Number((e.target as HTMLInputElement).value); selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight); markStale(); });
  const presetRow = q<HTMLDivElement>('presetRow'); presetRow.innerHTML = exportSizePresets.map((p) => `<button data-preset="${p.label}">${p.label}</button>`).join('');
  presetRow.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-preset]'); if (!b) return; const p = exportSizePresets.find((x) => x.label === b.dataset.preset)!; state.cellWidth = p.width; state.cellHeight = p.height; q<HTMLInputElement>('cellWidth').value = String(p.width); q<HTMLInputElement>('cellHeight').value = String(p.height); selectedPresetLabel = p.label; markStale(); });

  partChips.addEventListener('click', (e) => { const toggle = (e.target as HTMLElement).closest('[data-toggle-vis]') as HTMLElement | null; if (toggle) { const p = parts.find((x) => x.name === toggle.dataset.toggleVis); if (p) p.visible = !p.visible; renderParts(); scheduleWorkspaceRender(); return; } const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-part]'); if (chip?.dataset.part) activePart = chip.dataset.part; renderParts(); });
  q<HTMLInputElement>('brushSize').addEventListener('input', (e) => { brushSize = Number((e.target as HTMLInputElement).value); renderParts(); });
  q<HTMLInputElement>('overlayOpacity').addEventListener('input', (e) => { overlayOpacity = Number((e.target as HTMLInputElement).value); parts.forEach((p) => markPartDirty(p.name)); renderParts(); scheduleWorkspaceRender(); });
  q<HTMLButtonElement>('brushAddMode').addEventListener('click', () => { toolMode = 'brush-add'; renderParts(); }); q<HTMLButtonElement>('brushEraseMode').addEventListener('click', () => { toolMode = 'brush-erase'; renderParts(); }); q<HTMLButtonElement>('lassoAddMode').addEventListener('click', () => { toolMode = 'lasso-add'; renderParts(); }); q<HTMLButtonElement>('lassoEraseMode').addEventListener('click', () => { toolMode = 'lasso-erase'; renderParts(); });
  q<HTMLButtonElement>('cancelLasso').addEventListener('click', () => { lassoPoints = []; renderParts(); scheduleWorkspaceRender(); }); q<HTMLButtonElement>('undoMaskAction').addEventListener('click', () => { if (undoMaskAction) undoMaskAction(); undoMaskAction = null; renderParts(); scheduleWorkspaceRender(); });

  const paint = (from: Point, to: Point) => { const part = parts.find((p) => p.name === activePart); if (!part?.maskCanvas) return; if (!undoMaskAction) { const before = part.maskCanvas.getContext('2d')!.getImageData(0,0,part.maskCanvas.width,part.maskCanvas.height); undoMaskAction = () => part.maskCanvas!.getContext('2d')!.putImageData(before,0,0); } const ctx = part.maskCanvas.getContext('2d')!; ctx.globalCompositeOperation = toolMode === 'brush-add' ? 'source-over' : 'destination-out'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brushSize * 2; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.beginPath(); ctx.arc(to.x, to.y, brushSize,0,Math.PI*2); ctx.fill(); markPartDirty(part.name); };
  const commitLasso = () => { const part = parts.find((p) => p.name === activePart); if (!part?.maskCanvas || lassoPoints.length < 3) { lassoPoints = []; return; } const before = part.maskCanvas.getContext('2d')!.getImageData(0,0,part.maskCanvas.width,part.maskCanvas.height); undoMaskAction = () => part.maskCanvas!.getContext('2d')!.putImageData(before,0,0); const ctx = part.maskCanvas.getContext('2d')!; ctx.globalCompositeOperation = toolMode === 'lasso-add' ? 'source-over' : 'destination-out'; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(lassoPoints[0]!.x,lassoPoints[0]!.y); for (let i=1;i<lassoPoints.length;i++) ctx.lineTo(lassoPoints[i]!.x,lassoPoints[i]!.y); ctx.closePath(); ctx.fill(); lassoPoints = []; markPartDirty(part.name); };
  const finish = (evt: PointerEvent) => { if (activePointerId !== evt.pointerId) return; workspace.releasePointerCapture(evt.pointerId); if (toolMode.startsWith('lasso-')) commitLasso(); isPainting = false; activePointerId = null; lastPaintPoint = null; renderParts(); scheduleWorkspaceRender(); };
  workspace.addEventListener('pointerdown', (evt) => { if (!state.analysis) return; evt.preventDefault(); workspace.setPointerCapture(evt.pointerId); isPainting = true; activePointerId = evt.pointerId; const p = sourcePointFromEvent(evt); if (!p) return; lastPaintPoint = p; if (toolMode.startsWith('brush-')) paint(p,p); else lassoPoints = [p]; scheduleWorkspaceRender(); });
  workspace.addEventListener('pointermove', (evt) => { const p = sourcePointFromEvent(evt); if (!p) return; hoverPoint = p; if (isPainting && activePointerId === evt.pointerId && lastPaintPoint) { evt.preventDefault(); if (toolMode.startsWith('brush-')) { paint(lastPaintPoint,p); lastPaintPoint = p; } else lassoPoints.push(p); } scheduleWorkspaceRender(); });
  workspace.addEventListener('pointerup', finish); workspace.addEventListener('pointercancel', finish);

  q<HTMLButtonElement>('saveProject').addEventListener('click', () => { if (!state.analysis || !sourceImageDataUrl) return; const project: ProjectSaveData = { sourceImageDataUrl, sourceImageWidth: state.analysis.width, sourceImageHeight: state.analysis.height, sourceBounds: state.analysis.sourceBounds, floorY: state.analysis.floorY, parts: parts.map((p) => ({ name: p.name, visible: p.visible, color: p.color, maskDataUrl: p.maskCanvas?.toDataURL('image/png') ?? null })), layerOrder: parts.map((p) => p.name), exportSettings: { frameCount: state.frameCount, cellWidth: state.cellWidth, cellHeight: state.cellHeight, selectedPresetLabel, recommendedPresetLabel, recommendedCellWidth, recommendedCellHeight } }; downloadBlob('sprite-rig-project.json', new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })); });
  q<HTMLInputElement>('loadProject').addEventListener('change', async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; const parsed = JSON.parse(await file.text()) as ProjectSaveData; sourceImageDataUrl = parsed.sourceImageDataUrl; image = await loadPngFromFile(new File([await (await fetch(parsed.sourceImageDataUrl)).blob()], 'project.png', { type: 'image/png' })); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image, 0, 0); state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0,0,c.width,c.height)); for (const part of parts) { part.maskCanvas = document.createElement('canvas'); part.maskCanvas.width = state.analysis.width; part.maskCanvas.height = state.analysis.height; } for (const saved of parsed.parts) { const p = parts.find((x) => x.name === saved.name); if (!p) continue; p.visible = saved.visible; if (saved.maskDataUrl && p.maskCanvas) { const m = await loadPngFromFile(new File([await (await fetch(saved.maskDataUrl)).blob()], 'mask.png', { type: 'image/png' })); p.maskCanvas.getContext('2d')!.drawImage(m, 0, 0); } markPartDirty(p.name); } renderParts(); scheduleWorkspaceRender(); setStatus('Loaded project JSON.'); });

  renderParts(); scheduleWorkspaceRender(); startPreviewLoop(); selfCheck();
}
