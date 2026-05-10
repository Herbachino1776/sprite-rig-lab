import { analyzeAlpha, type SpriteAnalysis } from './image/alphaAnalysis';
import { loadPngFromFile } from './image/loadImage';
import { idleTransform } from './motion/idlePreset';
import { downloadBlob } from './export/exporters';
import { defaultState, defaultPartNames, type MaskPart, type ProjectSaveData } from './state/projectState';

type RenderPlan = { baseFloor: number; renderScale: number; maxMotionScale: number; sidePadding: number; topPadding: number; bleedRisk: boolean; warnings: string[] };
type ToolMode = 'brush-add' | 'brush-erase' | 'lasso-add' | 'lasso-erase' | 'set-pivot' | 'set-floor' | 'transform-part';
type Point = { x: number; y: number };
type OverlayCache = { canvas: HTMLCanvasElement | null; dirty: boolean; lastColor: string; lastOpacity: number };
type AnimationMode = 'whole-sprite-idle' | 'part-based-idle';
type IdleSettings = { breathingAmount: number; headSway: number; armDrift: number; overallIntensity: number };
type ExportMeta = { animationMode: AnimationMode; partBasedIdle: boolean; idleSettings: IdleSettings; frameCount: number; cellWidth: number; cellHeight: number; stripWidth: number; stripHeight: number; floorY: number; renderScale: number; selectedPresetLabel: string; warnings: string[]; bleedRisk: boolean };
type PreviewMode = 'idle-strip' | 'part-layer' | 'composite-parts';
type MaskStats = { bounds: { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number }; area: number; centroid: Point; bottomCenter: Point; touchesFloor: boolean; warnings: string[] };

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
  let previewMode: PreviewMode = 'idle-strip';
  let animationMode: AnimationMode = 'whole-sprite-idle';
  const defaultIdleSettings: IdleSettings = { breathingAmount: 1, headSway: 1, armDrift: 1, overallIntensity: 1 };
  let idleSettings: IdleSettings = { ...defaultIdleSettings };
  let selectedPartLayerName = defaultPartNames[0] as string;
  const extractedPartLayers = new Map<string, HTMLCanvasElement>();

  let activePart = defaultPartNames[0] as string;
  let toolMode: ToolMode = 'brush-add';
  const partTransforms = new Map<string, { rotationDeg: number; translateX: number; translateY: number; scaleX: number; scaleY: number }>();
  let brushSize = 24;
  let overlayOpacity = 0.45;
  let isPainting = false;
  let activePointerId: number | null = null;
  let lastPaintPoint: Point | null = null;
  let lassoPoints: Point[] = [];
  const pivots = new Map<string, Point>();
  const floorContacts = new Map<string, Point>();
  let undoMaskAction: (() => void) | null = null;
  let renderRaf: number | null = null;
  let previewRaf: number | null = null;

  root.innerHTML = `<div class="shell"><header class="topBar panel"><div><h1>Sprite Rig Lab</h1><p id="status" class="status">Waiting for PNG upload.</p></div><div class="fileBox"><label for="file">Upload PNG</label><input id="file" type="file" accept="image/png" /></div></header>
  <main class="workspaceArea panel"><canvas id="workspace" width="1024" height="1024"></canvas></main>
  <section class="toolDock" id="mobileDock"><div class="partChips" id="partChips"></div>
  <div class="segmented toolModes"><button id="brushAddMode" type="button">Brush Add</button><button id="brushEraseMode" type="button">Brush Erase</button><button id="lassoAddMode" type="button">Lasso Add</button><button id="lassoEraseMode" type="button">Lasso Erase</button><button id="setPivotMode" type="button">Set Pivot</button><button id="setFloorMode" type="button">Set Floor Contact</button><button id="transformPartMode" type="button">Transform Part</button></div><div id="partInfo" class="partInfo"></div>
  <div class="transformPanel" id="transformPanel" hidden><div class="compactSlider"><label for="rotationDeg">Rotate <span id="rotationDegValue">0°</span></label><input id="rotationDeg" type="range" min="-180" max="180" step="1" value="0" /></div><div class="compactSlider"><label for="uniformScale">Scale <span id="uniformScaleValue">1.00</span></label><input id="uniformScale" type="range" min="0.25" max="2" step="0.01" value="1" /></div><div class="row nudgeRow"><button id="nudgeUp" type="button">↑</button><button id="nudgeLeft" type="button">←</button><button id="nudgeRight" type="button">→</button><button id="nudgeDown" type="button">↓</button></div><div class="row"><button id="resetPartTransform" type="button">Reset Part</button><button id="resetAllTransforms" type="button">Reset All</button></div></div>
  <div class="autoRigPanel"><div class="row"><button id="autoPlacePivotsButton" class="primary" type="button">Auto-place pivots & floor contacts</button></div><label class="inlineToggle"><input id="overwritePivots" type="checkbox" />Overwrite existing pivots & floor contacts</label><div id="autoRigFeedback" class="partInfo">Auto rig hints are ready after masks (and optionally built part layers).</div></div>
  <div class="row"><button id="undoMaskAction" type="button" disabled>Undo</button><button id="cancelLasso" type="button" disabled>Cancel Lasso</button></div>
  <div class="compactSlider"><label for="brushSize">Brush <span id="brushSizeValue">24</span></label><input id="brushSize" type="range" min="1" max="256" value="24" /></div>
  <div class="compactSlider"><label for="overlayOpacity">Overlay <span id="overlayOpacityValue">45%</span></label><input id="overlayOpacity" type="range" min="0.05" max="1" step="0.05" value="0.45" /></div></section>
  <section class="panel stack"><details open><summary>Export & Preview</summary><div class="controls"><div class="row"><label>Frames<select id="frameCount"><option value="5">5</option><option value="6" selected>6</option></select></label><label>Cell W<input id="cellWidth" type="number" min="64" step="64" value="1024" /></label><label>Cell H<input id="cellHeight" type="number" min="64" step="64" value="1024" /></label></div><div class="presetRow" id="presetRow"></div><div class="segmented"><button id="wholeIdleMode" class="active" type="button">Whole Sprite Idle</button><button id="partIdleMode" type="button">Part-Based Idle</button></div><div class="compactSlider"><label for="breathingAmount">Breathing <span id="breathingAmountValue">1.00</span></label><input id="breathingAmount" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="headSway">Head sway <span id="headSwayValue">1.00</span></label><input id="headSway" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="armDrift">Arm drift <span id="armDriftValue">1.00</span></label><input id="armDrift" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="overallIntensity">Overall <span id="overallIntensityValue">1.00</span></label><input id="overallIntensity" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="row"><button id="resetIdleSettings" type="button">Reset idle settings</button></div><div class="row"><button id="generateButton" class="primary">Generate Strip</button><button id="pngButton">Export PNG Strip</button><button id="jsonButton">Export Metadata JSON</button></div><div class="row"><button id="buildPartLayersButton" type="button">Build Part Layers</button><button id="exportSelectedPartButton" type="button">Export Selected Part PNG</button></div><div class="row"><label>Preview Mode<select id="previewMode"><option value="idle-strip">Idle Strip</option><option value="part-layer">Part Layer Preview</option><option value="composite-parts">Composite Parts Preview</option></select></label></div><canvas id="preview" width="1024" height="1024"></canvas><pre id="renderReport"></pre></div></details>
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
  const hasMaskPixels = (canvas: HTMLCanvasElement) => { const data = canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data; for (let i=3;i<data.length;i+=4) if (data[i]>0) return true; return false; };
  const clampPoint = (p: Point): Point => {
    if (!state.analysis) return p;
    return { x: clamp(Math.round(p.x), 0, state.analysis.width - 1), y: clamp(Math.round(p.y), 0, state.analysis.height - 1) };
  };
  const computeMaskStats = (canvas: HTMLCanvasElement): MaskStats | null => {
    const { width, height } = canvas;
    const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha === 0) continue;
        area += 1;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!area || maxX < minX || maxY < minY) return null;
    const bottomY = maxY;
    let bottomSumX = 0;
    let bottomCount = 0;
    for (let x = minX; x <= maxX; x++) {
      const alpha = data[(bottomY * width + x) * 4 + 3];
      if (alpha === 0) continue;
      bottomSumX += x;
      bottomCount += 1;
    }
    const bounds = { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
    const centroid = { x: sumX / area, y: sumY / area };
    const bottomCenter = { x: bottomCount ? bottomSumX / bottomCount : (minX + maxX) / 2, y: maxY };
    const touchesFloor = !!state.analysis && maxY >= Math.floor(state.analysis.height * 0.85);
    const warnings: string[] = [];
    if (area < 24 || bounds.width < 4 || bounds.height < 4) warnings.push('tiny mask');
    return { bounds, area, centroid, bottomCenter, touchesFloor, warnings };
  };
  const getAutoPivotForPart = (partName: string, stats: MaskStats, torsoStats: MaskStats | null): Point => {
    const { bounds, centroid } = stats;
    if (partName === 'front_leg' || partName === 'rear_leg') return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY + bounds.height * 0.2 };
    if (partName === 'front_arm' || partName === 'rear_arm') return { x: bounds.minX + bounds.width * 0.45, y: bounds.minY + bounds.height * 0.2 };
    if (partName === 'head') return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY - bounds.height * 0.2 };
    if (partName === 'torso') return { x: centroid.x, y: bounds.minY + bounds.height * 0.65 };
    if (partName === 'horns') return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY - bounds.height * 0.1 };
    if (partName === 'tail') {
      if (torsoStats) {
        const torsoCenterX = torsoStats.centroid.x;
        const nearLeft = Math.abs(bounds.minX - torsoCenterX) <= Math.abs(bounds.maxX - torsoCenterX);
        return { x: nearLeft ? bounds.minX + bounds.width * 0.15 : bounds.maxX - bounds.width * 0.15, y: centroid.y };
      }
      return { x: bounds.minX + bounds.width * 0.3, y: centroid.y };
    }
    return { x: centroid.x, y: centroid.y };
  };
  const runAutoRigHints = () => {
    if (!state.analysis) {
      setStatus('Load a PNG before auto-place.', true);
      return;
    }
    ensureMaskCanvases();
    if (!extractedPartLayers.size) {
      setStatus('Build Part Layers first for best auto-place results.', true);
      q<HTMLDivElement>('autoRigFeedback').textContent = 'Build Part Layers first, then run Auto-place pivots.';
      return;
    }
    const overwrite = q<HTMLInputElement>('overwritePivots').checked;
    const torsoMask = parts.find((part) => part.name === 'torso')?.maskCanvas ?? null;
    const torsoStats = torsoMask ? computeMaskStats(torsoMask) : null;
    let suggestedCount = 0;
    let skippedCount = 0;
    const messages: string[] = [];
    for (const part of parts) {
      if (!part.maskCanvas) continue;
      const stats = computeMaskStats(part.maskCanvas);
      if (!stats) {
        skippedCount += 1;
        messages.push(`${part.name}: no mask found`);
        continue;
      }
      messages.push(...stats.warnings.map((w) => `${part.name}: ${w}`));
      const hasExistingPivot = pivots.has(part.name);
      const hasExistingFloor = floorContacts.has(part.name);
      const pivot = clampPoint(getAutoPivotForPart(part.name, stats, torsoStats));
      if (overwrite || !hasExistingPivot) {
        pivots.set(part.name, pivot);
        suggestedCount += 1;
        messages.push(`${part.name}: pivot suggested`);
      } else {
        messages.push(`${part.name}: pivot kept`);
      }
      const shouldHaveFloorContact = part.name === 'front_leg' || part.name === 'rear_leg' || (part.name === 'extra_01' && stats.touchesFloor);
      if (shouldHaveFloorContact) {
        if (overwrite || !hasExistingFloor) {
          floorContacts.set(part.name, clampPoint(stats.bottomCenter));
          messages.push(`${part.name}: floor contact suggested`);
        } else {
          messages.push(`${part.name}: floor contact kept`);
        }
      }
    }
    q<HTMLDivElement>('autoRigFeedback').textContent = `Suggested pivots for ${suggestedCount} part(s). ${skippedCount} part(s) skipped. ${messages.slice(0, 4).join(' · ')}`;
    setStatus(`Auto-place complete. Suggested pivots for ${suggestedCount} part(s).`);
    renderParts();
    scheduleWorkspaceRender();
    markStale();
  };
  const buildPartLayers = () => {
    if (!image || !state.analysis) return;
    ensureMaskCanvases();
    const sourceCanvas = document.createElement('canvas'); sourceCanvas.width = state.analysis.width; sourceCanvas.height = state.analysis.height; sourceCanvas.getContext('2d')!.drawImage(image,0,0);
    extractedPartLayers.clear();
    for (const part of parts) {
      if (!part.visible || !part.maskCanvas || !hasMaskPixels(part.maskCanvas)) continue;
      const layer = document.createElement('canvas');
      layer.width = state.analysis.width; layer.height = state.analysis.height;
      const layerCtx = layer.getContext('2d')!; layerCtx.drawImage(sourceCanvas,0,0); layerCtx.globalCompositeOperation = 'destination-in'; layerCtx.drawImage(part.maskCanvas,0,0); layerCtx.globalCompositeOperation = 'source-over';
      extractedPartLayers.set(part.name, layer);
    }
    if (!extractedPartLayers.has(selectedPartLayerName)) selectedPartLayerName = parts[0]?.name ?? selectedPartLayerName;
    setStatus(`Built ${extractedPartLayers.size} part layer(s).`);
  };

  const sourcePointFromEvent = (evt: PointerEvent): Point | null => {
    if (!state.analysis) return null;
    const p = getCanvasPointFromPointerEvent(evt, workspace);
    return { x: clamp(Math.round((p.x - workspaceTransform.offsetX) / workspaceTransform.scale), 0, state.analysis.width - 1), y: clamp(Math.round((p.y - workspaceTransform.offsetY) / workspaceTransform.scale), 0, state.analysis.height - 1) };
  };
  const scheduleWorkspaceRender = () => { if (renderRaf !== null) return; renderRaf = requestAnimationFrame(() => { renderRaf = null; renderWorkspace(); }); };

  const getTransform = (name: string) => {
    if (!partTransforms.has(name)) partTransforms.set(name, { rotationDeg: 0, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 });
    return partTransforms.get(name)!;
  };

  const renderParts = () => {
    partChips.innerHTML = parts.map((p) => `<button class="partChip ${p.name === activePart ? 'active' : ''}" data-part="${p.name}"><span class="swatch" style="background:${p.color}"></span><span class="partName">${p.name}</span><span data-toggle-vis="${p.name}">${p.visible ? '👁' : '🚫'}</span></button>`).join('');
    ['brushAddMode','brushEraseMode','lassoAddMode','lassoEraseMode','setPivotMode','setFloorMode','transformPartMode'].forEach((id, i) => q<HTMLButtonElement>(id).classList.toggle('active', ['brush-add','brush-erase','lasso-add','lasso-erase','set-pivot','set-floor','transform-part'][i] === toolMode));
    q<HTMLButtonElement>('cancelLasso').disabled = lassoPoints.length === 0;
    q<HTMLButtonElement>('undoMaskAction').disabled = !undoMaskAction;
    brushSizeValue.textContent = String(brushSize); overlayOpacityValue.textContent = `${Math.round(overlayOpacity * 100)}%`;
    const pivot = pivots.get(activePart);
    const floor = floorContacts.get(activePart);
    const transform = getTransform(activePart);
    q<HTMLDivElement>('partInfo').innerHTML = `<strong>${activePart}</strong> · pivot: ${pivot ? `${pivot.x},${pivot.y}` : '—'} · floor: ${floor ? `${floor.x},${floor.y}` : '—'} · rot ${transform.rotationDeg.toFixed(0)}°`;
    const panel = q<HTMLDivElement>('transformPanel');
    panel.hidden = toolMode !== 'transform-part';
    q<HTMLSpanElement>('rotationDegValue').textContent = `${transform.rotationDeg.toFixed(0)}°`;
    q<HTMLInputElement>('rotationDeg').value = String(transform.rotationDeg);
    q<HTMLSpanElement>('uniformScaleValue').textContent = transform.scaleX.toFixed(2);
    q<HTMLInputElement>('uniformScale').value = String(transform.scaleX);
  };

  const renderWorkspace = () => { /* unchanged drawing behavior */
    const ctx = workspace.getContext('2d')!; ctx.clearRect(0, 0, workspace.width, workspace.height); if (!image || !state.analysis) return; ensureMaskCanvases();
    const scale = Math.min(workspace.width / image.width, workspace.height / image.height, 1); const drawW = image.width * scale; const drawH = image.height * scale;
    workspaceTransform.offsetX = (workspace.width - drawW) / 2; workspaceTransform.offsetY = (workspace.height - drawH) / 2; workspaceTransform.scale = scale;
    ctx.drawImage(image, workspaceTransform.offsetX, workspaceTransform.offsetY, drawW, drawH);
    for (const part of parts) { if (!part.visible || !part.maskCanvas) continue; const entry = overlayCache.get(part.name)!; if (entry.dirty) { entry.canvas = entry.canvas ?? document.createElement('canvas'); entry.canvas.width = part.maskCanvas.width; entry.canvas.height = part.maskCanvas.height; const src = part.maskCanvas.getContext('2d')!.getImageData(0,0,part.maskCanvas.width,part.maskCanvas.height); const out = entry.canvas.getContext('2d')!.createImageData(src.width, src.height); const rgb = part.color.match(/[a-f\d]{2}/gi)?.map((v) => Number.parseInt(v,16)) ?? [255,0,255]; for (let i=0;i<src.data.length;i+=4) if (src.data[i+3]>0) { out.data[i]=rgb[0]; out.data[i+1]=rgb[1]; out.data[i+2]=rgb[2]; out.data[i+3]=Math.round(overlayOpacity*255); } entry.canvas.getContext('2d')!.putImageData(out,0,0); entry.dirty = false; } if (entry.canvas) ctx.drawImage(entry.canvas, workspaceTransform.offsetX, workspaceTransform.offsetY, drawW, drawH); }
    if (lassoPoints.length) { ctx.strokeStyle = '#9fd7ff'; ctx.beginPath(); ctx.moveTo(workspaceTransform.offsetX + lassoPoints[0]!.x * workspaceTransform.scale, workspaceTransform.offsetY + lassoPoints[0]!.y * workspaceTransform.scale); for (let i=1;i<lassoPoints.length;i++) ctx.lineTo(workspaceTransform.offsetX + lassoPoints[i]!.x * workspaceTransform.scale, workspaceTransform.offsetY + lassoPoints[i]!.y * workspaceTransform.scale); ctx.stroke(); }
    for (const part of parts) {
      const pivot = pivots.get(part.name);
      if (pivot) {
        const isActive = part.name === activePart;
        const px = workspaceTransform.offsetX + pivot.x * workspaceTransform.scale;
        const py = workspaceTransform.offsetY + pivot.y * workspaceTransform.scale;
        ctx.save();
        ctx.strokeStyle = isActive ? '#ffd166' : '#ffd16688';
        ctx.lineWidth = isActive ? 3 : 2;
        ctx.beginPath(); ctx.arc(px, py, isActive ? 10 : 8, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px - 12, py); ctx.lineTo(px + 12, py); ctx.moveTo(px, py - 12); ctx.lineTo(px, py + 12); ctx.stroke();
        ctx.restore();
      }
      const floor = floorContacts.get(part.name);
      if (floor) {
        const fx = workspaceTransform.offsetX + floor.x * workspaceTransform.scale;
        const fy = workspaceTransform.offsetY + floor.y * workspaceTransform.scale;
        ctx.save();
        ctx.fillStyle = part.name === activePart ? '#7ee787' : '#7ee78799';
        ctx.beginPath(); ctx.moveTo(fx, fy - 10); ctx.lineTo(fx + 9, fy + 8); ctx.lineTo(fx - 9, fy + 8); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  };

  const compileStrip = () => {
    if (!image || !state.analysis) return;
    if (animationMode === 'part-based-idle' && !extractedPartLayers.size) { setStatus('Build Part Layers first.', true); return; }
    const plan = createRenderPlan(state.analysis, state.cellWidth, state.cellHeight, state.frameCount);
    const canvas = document.createElement('canvas'); canvas.width = state.cellWidth * state.frameCount; canvas.height = state.cellHeight;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < state.frameCount; i++) {
      const t = idleTransform(i, state.frameCount);
      if (animationMode === 'whole-sprite-idle') {
        const pivotX = state.analysis.sourceBounds.x + state.analysis.sourceBounds.width / 2;
        ctx.save(); ctx.translate(i * state.cellWidth + state.cellWidth / 2  , plan.baseFloor + t.bobY * plan.renderScale); ctx.scale(plan.renderScale * t.scale, plan.renderScale * t.scale); ctx.drawImage(image, -pivotX, -state.analysis.floorY); ctx.restore();
      } else {
        const intensity = idleSettings.overallIntensity;
        const phase = (i / state.frameCount) * Math.PI * 2;
        const sortedParts = parts.slice();
        for (const part of sortedParts) {
          if (!part.visible) continue;
          const layer = extractedPartLayers.get(part.name);
          if (!layer) continue;
          const partPivot = pivots.get(part.name) ?? { x: layer.width / 2, y: layer.height / 2 };
          const role = part.name;
          let bobY = 0; let rot = 0; let sx = 1; let sy = 1; let driftX = 0;
          if (role === 'torso') { const b = 0.01 * idleSettings.breathingAmount * intensity; sx += Math.sin(phase) * b; sy += Math.sin(phase) * b * 0.7; }
          else if (role === 'head' || role === 'horns') { bobY = Math.sin(phase + 0.5) * 2.5 * idleSettings.headSway * intensity; driftX = Math.sin(phase) * 1.6 * idleSettings.headSway * intensity; rot = Math.sin(phase + 1) * 1.5 * idleSettings.headSway * intensity; }
          else if (role === 'front_arm' || role === 'rear_arm' || role === 'tail' || role === 'extra_01') { bobY = Math.sin(phase + 0.8) * 1.6 * idleSettings.armDrift * intensity; driftX = Math.sin(phase + 0.4) * 1.2 * idleSettings.armDrift * intensity; rot = Math.sin(phase + 0.2) * 1.8 * idleSettings.armDrift * intensity; }
          else if (role === 'front_leg' || role === 'rear_leg') { bobY = Math.sin(phase) * 0.35 * intensity; rot = Math.sin(phase + 0.4) * 0.4 * intensity; }
          ctx.save();
          ctx.translate(i * state.cellWidth + state.cellWidth / 2, plan.baseFloor);
          ctx.scale(plan.renderScale, plan.renderScale);
          ctx.translate(partPivot.x + driftX, partPivot.y + bobY - state.analysis.floorY);
          ctx.rotate((rot * Math.PI) / 180);
          ctx.scale(sx, sy);
          ctx.drawImage(layer, -partPivot.x, -partPivot.y);
          ctx.restore();
        }
      }
    }
    stripCanvas = canvas; lastRenderPlan = plan; stalePreview = false;
    exportMeta = { animationMode, partBasedIdle: animationMode === 'part-based-idle', idleSettings: { ...idleSettings }, frameCount: state.frameCount, cellWidth: state.cellWidth, cellHeight: state.cellHeight, stripWidth: canvas.width, stripHeight: canvas.height, floorY: plan.baseFloor, renderScale: Number(plan.renderScale.toFixed(4)), selectedPresetLabel, warnings: plan.warnings, bleedRisk: plan.bleedRisk };
    renderReport.textContent = JSON.stringify(exportMeta, null, 2);
    setStatus(`Generated strip ${canvas.width}x${canvas.height}`);
  };

  const startPreviewLoop = () => {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    let lastTs = 0; let frame = 0;
    const tick = (ts: number) => { const ctx = preview.getContext('2d')!; ctx.clearRect(0,0,preview.width,preview.height); if (previewMode === 'idle-strip') { if (stripCanvas && !stalePreview) { if (ts - lastTs > 180) { frame = (frame + 1) % state.frameCount; lastTs = ts; } const sx = frame * state.cellWidth; ctx.drawImage(stripCanvas, sx, 0, state.cellWidth, state.cellHeight, 0, 0, preview.width, preview.height); } } else { const scale = state.analysis ? Math.min(preview.width / state.analysis.width, preview.height / state.analysis.height, 1) : 1; const drawW = state.analysis ? state.analysis.width * scale : preview.width; const drawH = state.analysis ? state.analysis.height * scale : preview.height; const offsetX = (preview.width - drawW) / 2; const offsetY = (preview.height - drawH) / 2; if (previewMode === 'part-layer') { const selected = extractedPartLayers.get(selectedPartLayerName); if (selected) ctx.drawImage(selected, offsetX, offsetY, drawW, drawH); } else if (previewMode === 'composite-parts') { if (!extractedPartLayers.size) { ctx.fillStyle = '#b8d3ea'; ctx.font = '16px sans-serif'; ctx.fillText('Build Part Layers first.', 24, 40); } for (const part of parts) { if (!part.visible) continue; const layer = extractedPartLayers.get(part.name); if (!layer) continue; const t = getTransform(part.name); const pivot = pivots.get(part.name) ?? { x: layer.width / 2, y: layer.height / 2 }; const px = offsetX + pivot.x * scale; const py = offsetY + pivot.y * scale; ctx.save(); ctx.translate(px + t.translateX * scale, py + t.translateY * scale); ctx.rotate((t.rotationDeg * Math.PI) / 180); ctx.scale(t.scaleX, t.scaleY); ctx.drawImage(layer, -pivot.x * scale, -pivot.y * scale, drawW, drawH); if (part.name === activePart && toolMode === 'transform-part') { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.strokeRect(-pivot.x * scale, -pivot.y * scale, drawW, drawH); } ctx.restore(); } } } previewRaf = requestAnimationFrame(tick); };
    previewRaf = requestAnimationFrame(tick);
  };

  q<HTMLInputElement>('file').addEventListener('change', async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; image = await loadPngFromFile(file); sourceImageDataUrl = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(file); }); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image,0,0); state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0,0,c.width,c.height)); sourceQuality.textContent = `Source: ${state.analysis.width}x${state.analysis.height}\nFloorY: ${state.analysis.floorY}`; ensureMaskCanvases(); renderParts(); scheduleWorkspaceRender(); markStale(); setStatus(`Loaded ${file.name}`); q<HTMLButtonElement>('saveProject').disabled = false; });

  generateButton.addEventListener('click', compileStrip);
  const syncIdleReadout = () => {
    q<HTMLSpanElement>('breathingAmountValue').textContent = idleSettings.breathingAmount.toFixed(2);
    q<HTMLSpanElement>('headSwayValue').textContent = idleSettings.headSway.toFixed(2);
    q<HTMLSpanElement>('armDriftValue').textContent = idleSettings.armDrift.toFixed(2);
    q<HTMLSpanElement>('overallIntensityValue').textContent = idleSettings.overallIntensity.toFixed(2);
    q<HTMLButtonElement>('wholeIdleMode').classList.toggle('active', animationMode === 'whole-sprite-idle');
    q<HTMLButtonElement>('partIdleMode').classList.toggle('active', animationMode === 'part-based-idle');
  };
  q<HTMLButtonElement>('wholeIdleMode').addEventListener('click', () => { animationMode = 'whole-sprite-idle'; markStale(); syncIdleReadout(); });
  q<HTMLButtonElement>('partIdleMode').addEventListener('click', () => { animationMode = 'part-based-idle'; markStale(); syncIdleReadout(); });
  q<HTMLInputElement>('breathingAmount').addEventListener('input', (e) => { idleSettings.breathingAmount = Number((e.target as HTMLInputElement).value); markStale(); syncIdleReadout(); });
  q<HTMLInputElement>('headSway').addEventListener('input', (e) => { idleSettings.headSway = Number((e.target as HTMLInputElement).value); markStale(); syncIdleReadout(); });
  q<HTMLInputElement>('armDrift').addEventListener('input', (e) => { idleSettings.armDrift = Number((e.target as HTMLInputElement).value); markStale(); syncIdleReadout(); });
  q<HTMLInputElement>('overallIntensity').addEventListener('input', (e) => { idleSettings.overallIntensity = Number((e.target as HTMLInputElement).value); markStale(); syncIdleReadout(); });
  q<HTMLButtonElement>('resetIdleSettings').addEventListener('click', () => { idleSettings = { ...defaultIdleSettings }; q<HTMLInputElement>('breathingAmount').value = '1'; q<HTMLInputElement>('headSway').value = '1'; q<HTMLInputElement>('armDrift').value = '1'; q<HTMLInputElement>('overallIntensity').value = '1'; markStale(); syncIdleReadout(); });
  q<HTMLButtonElement>('buildPartLayersButton').addEventListener('click', () => { buildPartLayers(); });
  q<HTMLButtonElement>('autoPlacePivotsButton').addEventListener('click', runAutoRigHints);
  q<HTMLButtonElement>('exportSelectedPartButton').addEventListener('click', () => { const selected = extractedPartLayers.get(selectedPartLayerName); if (!selected) return; selected.toBlob((blob) => blob && downloadBlob(`${selectedPartLayerName}.png`, blob)); });
  q<HTMLSelectElement>('previewMode').addEventListener('change', (e) => { previewMode = (e.target as HTMLSelectElement).value as PreviewMode; });
  pngButton.addEventListener('click', () => { if (!stripCanvas) return; stripCanvas.toBlob((blob) => blob && downloadBlob('sprite-strip.png', blob)); });
  jsonButton.addEventListener('click', () => { if (!exportMeta) return; downloadBlob('sprite-strip-metadata.json', new Blob([JSON.stringify(exportMeta, null, 2)], { type: 'application/json' })); });

  q<HTMLSelectElement>('frameCount').addEventListener('change', (e) => { state.frameCount = Number((e.target as HTMLSelectElement).value) as 5 | 6; markStale(); });
  q<HTMLInputElement>('cellWidth').addEventListener('input', (e) => { state.cellWidth = Number((e.target as HTMLInputElement).value); selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight); markStale(); });
  q<HTMLInputElement>('cellHeight').addEventListener('input', (e) => { state.cellHeight = Number((e.target as HTMLInputElement).value); selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight); markStale(); });
  const presetRow = q<HTMLDivElement>('presetRow'); presetRow.innerHTML = exportSizePresets.map((p) => `<button data-preset="${p.label}">${p.label}</button>`).join('');
  presetRow.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-preset]'); if (!b) return; const p = exportSizePresets.find((x) => x.label === b.dataset.preset)!; state.cellWidth = p.width; state.cellHeight = p.height; q<HTMLInputElement>('cellWidth').value = String(p.width); q<HTMLInputElement>('cellHeight').value = String(p.height); selectedPresetLabel = p.label; markStale(); });

  partChips.addEventListener('click', (e) => { const toggle = (e.target as HTMLElement).closest('[data-toggle-vis]') as HTMLElement | null; if (toggle) { const p = parts.find((x) => x.name === toggle.dataset.toggleVis); if (p) p.visible = !p.visible; renderParts(); scheduleWorkspaceRender(); return; } const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-part]'); if (chip?.dataset.part) { activePart = chip.dataset.part; selectedPartLayerName = chip.dataset.part; } renderParts(); });
  q<HTMLInputElement>('brushSize').addEventListener('input', (e) => { brushSize = Number((e.target as HTMLInputElement).value); renderParts(); });
  q<HTMLInputElement>('overlayOpacity').addEventListener('input', (e) => { overlayOpacity = Number((e.target as HTMLInputElement).value); parts.forEach((p) => markPartDirty(p.name)); renderParts(); scheduleWorkspaceRender(); });
  q<HTMLButtonElement>('brushAddMode').addEventListener('click', () => { toolMode = 'brush-add'; renderParts(); }); q<HTMLButtonElement>('brushEraseMode').addEventListener('click', () => { toolMode = 'brush-erase'; renderParts(); }); q<HTMLButtonElement>('lassoAddMode').addEventListener('click', () => { toolMode = 'lasso-add'; renderParts(); }); q<HTMLButtonElement>('lassoEraseMode').addEventListener('click', () => { toolMode = 'lasso-erase'; renderParts(); }); q<HTMLButtonElement>('setPivotMode').addEventListener('click', () => { toolMode = 'set-pivot'; lassoPoints = []; renderParts(); scheduleWorkspaceRender(); }); q<HTMLButtonElement>('setFloorMode').addEventListener('click', () => { toolMode = 'set-floor'; lassoPoints = []; renderParts(); scheduleWorkspaceRender(); }); q<HTMLButtonElement>('transformPartMode').addEventListener('click', () => { toolMode = 'transform-part'; renderParts(); });
  q<HTMLButtonElement>('cancelLasso').addEventListener('click', () => { lassoPoints = []; renderParts(); scheduleWorkspaceRender(); }); q<HTMLButtonElement>('undoMaskAction').addEventListener('click', () => { if (undoMaskAction) undoMaskAction(); undoMaskAction = null; renderParts(); scheduleWorkspaceRender(); });

  const paint = (from: Point, to: Point) => { const part = parts.find((p) => p.name === activePart); if (!part?.maskCanvas) return; if (!undoMaskAction) { const before = part.maskCanvas.getContext('2d')!.getImageData(0,0,part.maskCanvas.width,part.maskCanvas.height); undoMaskAction = () => part.maskCanvas!.getContext('2d')!.putImageData(before,0,0); } const ctx = part.maskCanvas.getContext('2d')!; ctx.globalCompositeOperation = toolMode === 'brush-add' ? 'source-over' : 'destination-out'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brushSize * 2; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.beginPath(); ctx.arc(to.x, to.y, brushSize,0,Math.PI*2); ctx.fill(); markPartDirty(part.name); };
  const commitLasso = () => { const part = parts.find((p) => p.name === activePart); if (!part?.maskCanvas || lassoPoints.length < 3) { lassoPoints = []; return; } const before = part.maskCanvas.getContext('2d')!.getImageData(0,0,part.maskCanvas.width,part.maskCanvas.height); undoMaskAction = () => part.maskCanvas!.getContext('2d')!.putImageData(before,0,0); const ctx = part.maskCanvas.getContext('2d')!; ctx.globalCompositeOperation = toolMode === 'lasso-add' ? 'source-over' : 'destination-out'; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(lassoPoints[0]!.x,lassoPoints[0]!.y); for (let i=1;i<lassoPoints.length;i++) ctx.lineTo(lassoPoints[i]!.x,lassoPoints[i]!.y); ctx.closePath(); ctx.fill(); lassoPoints = []; markPartDirty(part.name); };
  const finish = (evt: PointerEvent) => { if (activePointerId !== evt.pointerId) return; workspace.releasePointerCapture(evt.pointerId); if (toolMode.startsWith('lasso-')) commitLasso(); isPainting = false; activePointerId = null; lastPaintPoint = null; renderParts(); scheduleWorkspaceRender(); };
  workspace.addEventListener('pointerdown', (evt) => { if (!state.analysis) return; evt.preventDefault(); const p = sourcePointFromEvent(evt); if (!p) return; if (toolMode === 'set-pivot') { pivots.set(activePart, p); renderParts(); scheduleWorkspaceRender(); return; } if (toolMode === 'set-floor') { floorContacts.set(activePart, p); renderParts(); scheduleWorkspaceRender(); return; } if (toolMode === 'transform-part') return; workspace.setPointerCapture(evt.pointerId); isPainting = true; activePointerId = evt.pointerId; lastPaintPoint = p; if (toolMode.startsWith('brush-')) paint(p,p); else lassoPoints = [p]; scheduleWorkspaceRender(); });
  workspace.addEventListener('pointermove', (evt) => { const p = sourcePointFromEvent(evt); if (!p) return; if (isPainting && activePointerId === evt.pointerId && lastPaintPoint) { evt.preventDefault(); if (toolMode.startsWith('brush-')) { paint(lastPaintPoint,p); lastPaintPoint = p; } else lassoPoints.push(p); } scheduleWorkspaceRender(); });
  workspace.addEventListener('pointerup', finish); workspace.addEventListener('pointercancel', finish);

  q<HTMLButtonElement>('saveProject').addEventListener('click', () => { if (!state.analysis || !sourceImageDataUrl) return; const project: ProjectSaveData = { sourceImageDataUrl, sourceImageWidth: state.analysis.width, sourceImageHeight: state.analysis.height, sourceBounds: state.analysis.sourceBounds, floorY: state.analysis.floorY, parts: parts.map((p) => ({ name: p.name, visible: p.visible, color: p.color, maskDataUrl: p.maskCanvas?.toDataURL('image/png') ?? null })), pivots: Object.fromEntries(parts.map((p) => [p.name, pivots.get(p.name)])), floorContacts: Object.fromEntries(parts.map((p) => [p.name, floorContacts.get(p.name)])), transforms: Object.fromEntries(parts.map((p) => [p.name, getTransform(p.name)])), layerOrder: parts.map((p) => p.name), exportSettings: { frameCount: state.frameCount, cellWidth: state.cellWidth, cellHeight: state.cellHeight, selectedPresetLabel, recommendedPresetLabel, recommendedCellWidth, recommendedCellHeight }, animationMode, idleSettings: { ...idleSettings } }; downloadBlob('sprite-rig-project.json', new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })); });
  q<HTMLInputElement>('loadProject').addEventListener('change', async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; const parsed = JSON.parse(await file.text()) as ProjectSaveData; sourceImageDataUrl = parsed.sourceImageDataUrl; image = await loadPngFromFile(new File([await (await fetch(parsed.sourceImageDataUrl)).blob()], 'project.png', { type: 'image/png' })); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image, 0, 0); state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0,0,c.width,c.height)); for (const part of parts) { part.maskCanvas = document.createElement('canvas'); part.maskCanvas.width = state.analysis.width; part.maskCanvas.height = state.analysis.height; } for (const saved of parsed.parts) { const p = parts.find((x) => x.name === saved.name); if (!p) continue; p.visible = saved.visible; if (saved.maskDataUrl && p.maskCanvas) { const m = await loadPngFromFile(new File([await (await fetch(saved.maskDataUrl)).blob()], 'mask.png', { type: 'image/png' })); p.maskCanvas.getContext('2d')!.drawImage(m, 0, 0); } markPartDirty(p.name); } pivots.clear(); floorContacts.clear(); partTransforms.clear(); for (const part of parts) { const pv = parsed.pivots?.[part.name]; const fc = parsed.floorContacts?.[part.name]; const tf = parsed.transforms?.[part.name]; if (pv) pivots.set(part.name, pv); if (fc) floorContacts.set(part.name, fc); if (tf) partTransforms.set(part.name, tf); } animationMode = parsed.animationMode ?? 'whole-sprite-idle'; idleSettings = { ...defaultIdleSettings, ...parsed.idleSettings }; q<HTMLInputElement>('breathingAmount').value = String(idleSettings.breathingAmount); q<HTMLInputElement>('headSway').value = String(idleSettings.headSway); q<HTMLInputElement>('armDrift').value = String(idleSettings.armDrift); q<HTMLInputElement>('overallIntensity').value = String(idleSettings.overallIntensity); syncIdleReadout(); renderParts(); scheduleWorkspaceRender(); setStatus('Loaded project JSON.'); });


  q<HTMLInputElement>('rotationDeg').addEventListener('input', (e) => { const t = getTransform(activePart); t.rotationDeg = Number((e.target as HTMLInputElement).value); renderParts(); });
  q<HTMLInputElement>('uniformScale').addEventListener('input', (e) => { const t = getTransform(activePart); const v = Number((e.target as HTMLInputElement).value); t.scaleX = v; t.scaleY = v; renderParts(); });
  const nudgeBy = (dx: number, dy: number) => { const t = getTransform(activePart); t.translateX += dx; t.translateY += dy; renderParts(); };
  q<HTMLButtonElement>('nudgeLeft').addEventListener('click', () => nudgeBy(-2, 0));
  q<HTMLButtonElement>('nudgeRight').addEventListener('click', () => nudgeBy(2, 0));
  q<HTMLButtonElement>('nudgeUp').addEventListener('click', () => nudgeBy(0, -2));
  q<HTMLButtonElement>('nudgeDown').addEventListener('click', () => nudgeBy(0, 2));
  q<HTMLButtonElement>('resetPartTransform').addEventListener('click', () => { partTransforms.set(activePart, { rotationDeg: 0, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 }); renderParts(); });
  q<HTMLButtonElement>('resetAllTransforms').addEventListener('click', () => { for (const part of parts) partTransforms.set(part.name, { rotationDeg: 0, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 }); renderParts(); });

  syncIdleReadout(); renderParts(); scheduleWorkspaceRender(); startPreviewLoop(); selfCheck();
}
