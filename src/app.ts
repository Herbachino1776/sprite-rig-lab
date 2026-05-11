import { analyzeAlpha, type SpriteAnalysis } from './image/alphaAnalysis';
import { loadPngFromFile } from './image/loadImage';
import { idleTransform } from './motion/idlePreset';
import { downloadBlob } from './export/exporters';
import { defaultState, defaultPartNames, type MaskPart, type ProjectSaveData } from './state/projectState';

type RenderPlan = { baseFloor: number; renderScale: number; maxMotionScale: number; sidePadding: number; topPadding: number; bleedRisk: boolean; warnings: string[] };
type ToolMode = 'brush-add' | 'brush-erase' | 'lasso-add' | 'lasso-erase' | 'set-pivot' | 'set-floor' | 'transform-part';
type Point = { x: number; y: number };
type OverlayCache = { canvas: HTMLCanvasElement | null; dirty: boolean; lastColor: string; lastOpacity: number };
type AnimationMode = 'whole-sprite-idle' | 'part-based-idle' | 'part-based-small-walk' | 'part-based-attack';
type IdleSettings = { breathingAmount: number; headSway: number; armDrift: number; overallIntensity: number };
type AlphaBounds = { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
type MotionEnvelope = AlphaBounds & { frameHits: number };
type FrameBoundsReport = { frameIndex: number; alphaBounds: AlphaBounds | null; centerOffsetXBeforeCorrection: number; finalLeftMargin: number; finalRightMargin: number };
type WalkSettings = { walkIntensity: number; strideWidth: number; legCrossing: number; hipSway: number; armSwing: number; footLockStrength: number };
type AttackStyle = 'forward-strike' | 'overhead-chop';
type AttackSettings = { attackStyle: AttackStyle; attackIntensity: number; attackReach: number; torsoLean: number; armSwing: number; recoilAmount: number; chopRaiseAngle: number; chopDownAngle: number; chopArcAmount: number };
type SeamRepairSettings = { enabled: boolean; edgeBleedPx: number; edgeFeatherPx: number; jointOverlapPx: number; gapFillEnabled: boolean; seamBlendStrength: number };
type UndoEntry = { partName: string; imageData: ImageData };
type ExportMeta = { animationMode: AnimationMode; partBasedIdle: boolean; idleSettings: IdleSettings; walkSettings: WalkSettings; attackSettings: AttackSettings; seamRepairSettings: SeamRepairSettings; frameCount: number; cellWidth: number; cellHeight: number; stripWidth: number; stripHeight: number; floorY: number; renderScale: number; selectedPresetLabel: string; recommendedPresetLabel: string; warnings: string[]; bleedRisk: boolean; frameBounds: FrameBoundsReport[]; motionEnvelope: MotionEnvelope | null; motionSafeScale: number; clippingPrevented: boolean; recommendedCellWidth: number; recommendedCellHeight: number; leftMarginMin: number; rightMarginMin: number; topMarginMin: number; bottomMarginMin: number; processedLayersUsed: boolean; seamRepairWarnings: string[]; };
type PreviewMode = 'idle-strip' | 'part-layer' | 'composite-parts';
type ShellMode = 'mask' | 'rig' | 'animate' | 'export';
type MaskStats = { bounds: { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number }; area: number; centroid: Point; bottomCenter: Point; touchesFloor: boolean; warnings: string[] };
type FinePointerState = { active: boolean; canvasPoint: Point; sourcePoint: Point };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const exportSizePresets = [
  { width: 1024, height: 1024, label: '1024x1024 Compact' },
  { width: 1024, height: 1536, label: '1024x1536 Tall' },
  { width: 1536, height: 1536, label: '1536x1536 Large' },
  { width: 2048, height: 2048, label: '2048x2048 Production' },
  { width: 3072, height: 3072, label: '3072x3072 Large Motion' },
  { width: 4096, height: 4096, label: '4096x4096 Extreme Motion' },
] as const;
const preferredProductionPresetLabel = '2048x2048 Production';
const largeMotionPresetLabel = '3072x3072 Large Motion';
const extremeMotionPresetLabel = '4096x4096 Extreme Motion';
const partColors = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#c77dff', '#f94144', '#f3722c', '#90be6d', '#577590'];
const findPresetLabel = (width: number, height: number): string => exportSizePresets.find((preset) => preset.width === width && preset.height === height)?.label ?? `Custom ${width}x${height}`;

const getCanvasPointFromPointerEvent = (evt: PointerEvent, canvas: HTMLCanvasElement): Point => {
  const rect = canvas.getBoundingClientRect();
  return { x: (evt.clientX - rect.left) * (canvas.width / rect.width), y: (evt.clientY - rect.top) * (canvas.height / rect.height) };
};
const findAlphaBounds = (canvas: HTMLCanvasElement): AlphaBounds | null => {
  const { width, height } = canvas;
  const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
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
  let shellMode: ShellMode = 'mask';
  let animationMode: AnimationMode = 'whole-sprite-idle';
  const defaultIdleSettings: IdleSettings = { breathingAmount: 1, headSway: 1, armDrift: 1, overallIntensity: 1 };
  const defaultWalkSettings: WalkSettings = { walkIntensity: 1, strideWidth: 1, legCrossing: 0.25, hipSway: 1, armSwing: 1, footLockStrength: 0.85 };
  const defaultAttackSettings: AttackSettings = { attackStyle: 'forward-strike', attackIntensity: 1, attackReach: 1, torsoLean: 1, armSwing: 1, recoilAmount: 1, chopRaiseAngle: 68, chopDownAngle: 42, chopArcAmount: 1 };
  let idleSettings: IdleSettings = { ...defaultIdleSettings };
  let walkSettings: WalkSettings = { ...defaultWalkSettings };
  let attackSettings: AttackSettings = { ...defaultAttackSettings };
  const defaultSeamRepairSettings: SeamRepairSettings = { enabled: true, edgeBleedPx: 3, edgeFeatherPx: 1, jointOverlapPx: 8, gapFillEnabled: true, seamBlendStrength: 65 };
  let seamRepairSettings: SeamRepairSettings = { ...defaultSeamRepairSettings };
  let selectedPartLayerName = defaultPartNames[0] as string;
  const rawExtractedPartLayers = new Map<string, HTMLCanvasElement>();
  const processedPartLayers = new Map<string, HTMLCanvasElement>();
  let seamLayersNeedRebuild = true;
  let seamRepairPreviewMode = false;

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
  const undoStack: UndoEntry[] = [];
  const maxUndoEntries = 10;
  let renderRaf: number | null = null;
  let previewRaf: number | null = null;
  let fineMode = false;
  let finePointer: FinePointerState = { active: false, canvasPoint: { x: 0, y: 0 }, sourcePoint: { x: 0, y: 0 } };
  let lastTapTime = 0;

  root.innerHTML = `<div class="shell">
  <header class="topBar panel"><div class="brandBlock"><h1>SPRITE RIG LAB</h1></div><div class="projectButtons"><label class="fileLabel primary">Upload PNG<input id="file" type="file" accept="image/png" /></label><label class="fileLabel">Load Project<input id="loadProject" type="file" accept="application/json" /></label><button id="saveProject" disabled>Save Project</button></div><div class="savedCluster"><span id="savedStat" class="savedBadge">Project Unsaved</span><p id="status" class="status">Waiting for PNG upload.</p></div></header>
  <section class="panel statusRow"><span id="fileStat">none</span><span id="dimensionsStat">2048 × 2048</span><span id="partsStat">Parts: 0</span><span id="modeStat">Mode: Mask</span><span id="zoomStat">Zoom: 100%</span><span class="settingsStub">⚙</span></section>
  <main class="workspaceShell panel"><div class="zoomRail"><button type="button">+</button><span>100%</span><button type="button">−</button></div><section class="workspaceArea"><canvas id="workspace" width="1024" height="1024"></canvas></section><aside id="partInfo" class="partInfo inspector"></aside></main>
  <section class="panel partChipsWrap"><div class="partChips" id="partChips"></div></section>
  <section class="panel modeTabs"><button id="modeMask" class="active" type="button">✎ Mask</button><button id="modeRig" type="button">⎔ Rig</button><button id="modeAnimate" type="button">〰 Animate</button><button id="modeExport" type="button">⇩ Export</button></section>
  <section class="panel modeControls">
  <div id="maskControls"><div class="segmented toolModes"><button id="brushAddMode" type="button">Brush Add</button><button id="brushEraseMode" type="button">Brush Erase</button><button id="lassoAddMode" type="button">Lasso Add</button><button id="lassoEraseMode" type="button">Lasso Erase</button><button id="undoMaskAction" type="button" disabled>Undo</button><button id="cancelLasso" type="button" disabled>Cancel Lasso</button></div><div class="fineModeRow"><button id="fineModeToggle" type="button">Fine: Off</button><button id="fineModeExit" type="button" hidden>Exit Fine</button><span id="fineModeLabel" class="fineModeLabel" hidden>Fine Mode</span></div><div class="controlGrid"><div class="compactSlider"><label for="brushSize">Brush Size <span id="brushSizeValue">24</span></label><input id="brushSize" type="range" min="1" max="256" value="24" /></div><div class="compactSlider"><label for="overlayOpacity">Overlay Opacity <span id="overlayOpacityValue">45%</span></label><input id="overlayOpacity" type="range" min="0.05" max="1" step="0.05" value="0.45" /></div></div><div class="tipLine">Tip: Use Lasso Add to create clean masks around body parts.</div></div>
  <div id="rigControls" hidden><div class="segmented toolModes"><button id="setPivotMode" type="button">Set Pivot</button><button id="setFloorMode" type="button">Set Floor Contact</button><button id="transformPartMode" type="button">Transform Part</button></div><div class="autoRigPanel"><div class="row"><button id="autoPlacePivotsButton" class="primary" type="button">Auto-place pivots & floor contacts</button></div><label class="inlineToggle"><input id="overwritePivots" type="checkbox" />Overwrite existing pivots & floor contacts</label><div id="autoRigFeedback" class="partInfo">Auto rig hints are ready after masks (and optionally built part layers).</div></div><div class="transformPanel" id="transformPanel" hidden><div class="compactSlider"><label for="rotationDeg">Rotate <span id="rotationDegValue">0°</span></label><input id="rotationDeg" type="range" min="-180" max="180" step="1" value="0" /></div><div class="compactSlider"><label for="uniformScale">Scale <span id="uniformScaleValue">1.00</span></label><input id="uniformScale" type="range" min="0.25" max="2" step="0.01" value="1" /></div><div class="row nudgeRow"><button id="nudgeUp" type="button">↑</button><button id="nudgeLeft" type="button">←</button><button id="nudgeRight" type="button">→</button><button id="nudgeDown" type="button">↓</button></div><div class="row"><button id="resetPartTransform" type="button">Reset Part</button><button id="resetAllTransforms" type="button">Reset All</button></div></div></div>
  <div id="animateControls" hidden><div class="segmented"><button id="wholeIdleMode" class="active" type="button">Whole Sprite Idle</button><button id="partIdleMode" type="button">Part-Based Idle</button><button id="partWalkMode" type="button">Part-Based Small Walk</button><button id="partAttackMode" type="button">Part-Based Attack</button></div><div class="controlGrid" id="idleControlGrid"><div class="compactSlider"><label for="breathingAmount">Breathing <span id="breathingAmountValue">1.00</span></label><input id="breathingAmount" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="headSway">Head sway <span id="headSwayValue">1.00</span></label><input id="headSway" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="armDrift">Arm drift <span id="armDriftValue">1.00</span></label><input id="armDrift" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="overallIntensity">Overall <span id="overallIntensityValue">1.00</span></label><input id="overallIntensity" type="range" min="0" max="2" step="0.05" value="1" /></div></div><div class="controlGrid" id="walkControlGrid"><div class="compactSlider"><label for="walkIntensity">Walk intensity <span id="walkIntensityValue">1.00</span></label><input id="walkIntensity" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="strideWidth">Stride width <span id="strideWidthValue">1.00</span></label><input id="strideWidth" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="legCrossing">Leg crossing <span id="legCrossingValue">0.25</span></label><input id="legCrossing" type="range" min="0" max="1" step="0.05" value="0.25" /></div><div class="compactSlider"><label for="hipSway">Hip sway <span id="hipSwayValue">1.00</span></label><input id="hipSway" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="armSwing">Arm swing <span id="armSwingValue">1.00</span></label><input id="armSwing" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="footLockStrength">Foot lock <span id="footLockStrengthValue">0.85</span></label><input id="footLockStrength" type="range" min="0" max="1" step="0.05" value="0.85" /></div></div><div id="attackStyleRow" class="segmented"><button id="attackStyleForward" class="active" type="button">Forward Strike</button><button id="attackStyleChop" type="button">Overhead Chop</button></div><div class="controlGrid" id="attackControlGrid"><div class="compactSlider"><label for="attackIntensity">Attack intensity <span id="attackIntensityValue">1.00</span></label><input id="attackIntensity" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="attackReach">Attack reach <span id="attackReachValue">1.00</span></label><input id="attackReach" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="torsoLean">Torso lean <span id="torsoLeanValue">1.00</span></label><input id="torsoLean" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="attackArmSwing">Arm swing <span id="attackArmSwingValue">1.00</span></label><input id="attackArmSwing" type="range" min="0" max="2" step="0.05" value="1" /></div><div class="compactSlider"><label for="recoilAmount">Recoil amount <span id="recoilAmountValue">1.00</span></label><input id="recoilAmount" type="range" min="0" max="2" step="0.05" value="1" /></div><section class="panel seamRepairPanel" id="seamRepairPanel"><h3>SEAM REPAIR</h3><p class="seamSubline">Applied to part-based renders only.</p><p class="seamSubline">Rebuilds on Generate Strip.</p><div class="toggleGroup" id="seamRepairEnabled"><button id="seamRepairOff" type="button">Off</button><button id="seamRepairOn" type="button" class="active">On</button></div><div class="controlGrid"><div class="compactSlider"><label for="edgeBleedPx">Edge Bleed <span id="edgeBleedPxValue">2px</span></label><input id="edgeBleedPx" type="range" min="1" max="4" step="1" value="2" /></div><div class="compactSlider"><label for="edgeFeatherPx">Feather <span id="edgeFeatherPxValue">1.0px</span></label><input id="edgeFeatherPx" type="range" min="0" max="2" step="0.25" value="1" /></div><div class="compactSlider"><label for="jointOverlapPx">Joint Overlap <span id="jointOverlapPxValue">5px</span></label><input id="jointOverlapPx" type="range" min="2" max="12" step="1" value="5" /></div><div class="compactSlider"><label for="seamBlendStrength">Blend Strength <span id="seamBlendStrengthValue">50%</span></label><input id="seamBlendStrength" type="range" min="0" max="100" step="1" value="50" /></div></div><div class="toggleGroup" id="gapFillEnabled"><button id="gapFillOff" type="button">Gap Fill Off</button><button id="gapFillOn" type="button" class="active">Gap Fill On</button></div><div class="row"><button id="strongSeamTest" type="button">Strong Seam Test</button><button id="resetSeamSettings" type="button">Reset Seam Settings</button></div><div class="toggleGroup" id="seamRepairPreviewMode"><button id="seamPreviewRaw" type="button" class="active">Preview Raw</button><button id="seamPreviewProcessed" type="button">Preview Seam-Repaired</button></div><p id="seamDeltaWarning" class="seamWarning" hidden>No visible seam-repair delta detected. Try rebuilding part layers or increasing settings.</p></section></div><div class="row"><button id="resetIdleSettings" type="button">Reset idle settings</button><button id="resetWalkSettings" type="button">Reset walk settings</button><button id="resetAttackSettings" type="button">Reset attack settings</button><button id="generateButton" class="primary">Generate Strip</button><button id="buildPartLayersButton" type="button">Build Part Layers</button><button id="exportSelectedPartButton" type="button">Export Selected Part PNG</button></div><div class="row"><label>Preview Mode<select id="previewMode"><option value="idle-strip">Idle Strip</option><option value="part-layer">Part Layer Preview</option><option value="composite-parts">Composite Parts Preview</option></select></label></div><section class="previewPanel"><h3>Preview</h3><canvas id="preview" width="1024" height="1024"></canvas></section></div>
  <div id="exportControls" hidden><div class="controls"><div class="row"><label>Frames<select id="frameCount"><option value="5">5</option><option value="6" selected>6</option></select></label><label>W<input id="cellWidth" type="number" min="64" step="64" value="1024" /></label><label>H<input id="cellHeight" type="number" min="64" step="64" value="1024" /></label></div><div class="presetRow" id="presetRow"></div><div class="row"><button id="generateButtonExport" class="primary" type="button">Generate Strip</button><button id="pngButton">Export PNG Strip</button><button id="jsonButton">Export Metadata JSON</button></div><button type="button">View Export Report</button><pre id="renderReport"></pre></div><details><summary>Source Quality</summary><pre id="sourceQuality">No source loaded.</pre></details></div><div id="shellError" class="shellError" hidden></div></section></div>`;

  const q = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const workspace = q<HTMLCanvasElement>('workspace'); const preview = q<HTMLCanvasElement>('preview');
  const status = q<HTMLParagraphElement>('status'); const renderReport = q<HTMLPreElement>('renderReport'); const sourceQuality = q<HTMLPreElement>('sourceQuality');
  const generateButton = q<HTMLButtonElement>('generateButton'); const pngButton = q<HTMLButtonElement>('pngButton'); const jsonButton = q<HTMLButtonElement>('jsonButton');
  const partChips = q<HTMLDivElement>('partChips'); const brushSizeValue = q<HTMLSpanElement>('brushSizeValue'); const overlayOpacityValue = q<HTMLSpanElement>('overlayOpacityValue');

  const workspaceTransform = { offsetX: 0, offsetY: 0, scale: 1 };
  const parts: MaskPart[] = defaultPartNames.map((name, i) => ({ name, visible: true, color: partColors[i % partColors.length], maskCanvas: null }));
  const overlayCache = new Map<string, OverlayCache>();
  const defaultLayerOrder: string[] = [...defaultPartNames];
  const legacyBadDefaultLayerOrder: string[] = ['rear_arm', 'rear_leg', 'torso', 'head', 'front_arm', 'front_leg', 'tail', 'extra_01', 'horns'];

  const normalizeLayerOrder = (layerOrder: string[] | undefined): string[] => {
    if (!layerOrder?.length) return [...defaultLayerOrder];
    if (layerOrder.length === legacyBadDefaultLayerOrder.length && layerOrder.every((name, index) => name === legacyBadDefaultLayerOrder[index])) {
      return [...defaultLayerOrder];
    }
    const deduped = layerOrder.filter((name, index) => layerOrder.indexOf(name) === index);
    const ordered = deduped.filter((name) => defaultLayerOrder.includes(name));
    for (const partName of defaultLayerOrder) {
      if (!ordered.includes(partName)) ordered.push(partName);
    }
    return ordered;
  };

  const getCompositePartsInDrawOrder = (): MaskPart[] => {
    const rank = new Map<string, number>();
    defaultLayerOrder.forEach((name, index) => rank.set(name, index));
    return [...parts].sort((a, b) => (rank.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.name) ?? Number.MAX_SAFE_INTEGER));
  };

  const applySavedLayerOrder = (layerOrder: string[] | undefined) => {
    const rank = new Map<string, number>();
    const normalizedOrder = normalizeLayerOrder(layerOrder);
    normalizedOrder.forEach((name, index) => rank.set(name, index));
    parts.sort((a, b) => {
      const aRank = rank.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bRank = rank.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return defaultLayerOrder.indexOf(a.name) - defaultLayerOrder.indexOf(b.name);
    });
  };

  const setStatus = (m: string, e = false) => { status.textContent = m; status.classList.toggle('error', e); };
  const updateStatusRow = () => {
    q<HTMLSpanElement>('partsStat').textContent = `Parts: ${parts.filter((p) => p.visible).length}/${parts.length}`;
    q<HTMLSpanElement>('modeStat').textContent = `Mode: ${shellMode[0]?.toUpperCase()}${shellMode.slice(1)}`;
    q<HTMLSpanElement>('zoomStat').textContent = `Zoom: ${Math.round(workspaceTransform.scale * 100)}%`;
  };
  const updateExportButtonState = () => {
    const hasStrip = !!stripCanvas && !!exportMeta && !stalePreview;
    pngButton.disabled = !hasStrip;
    jsonButton.disabled = !hasStrip;
  };
  const markStale = () => {
    stalePreview = true;
    stripCanvas = null;
    exportMeta = null;
    renderReport.dataset.stale = 'true';
  
  q<HTMLButtonElement>('seamRepairOff').addEventListener('click', () => { seamRepairSettings.enabled = false; markStale(); syncSeamToggleUi(); });
  q<HTMLButtonElement>('seamRepairOn').addEventListener('click', () => { seamRepairSettings.enabled = true; markStale(); syncSeamToggleUi(); });
  q<HTMLButtonElement>('gapFillOff').addEventListener('click', () => { seamRepairSettings.gapFillEnabled = false; markStale(); syncSeamToggleUi(); });
  q<HTMLButtonElement>('gapFillOn').addEventListener('click', () => { seamRepairSettings.gapFillEnabled = true; markStale(); syncSeamToggleUi(); });
  q<HTMLButtonElement>('seamPreviewRaw').addEventListener('click', () => { seamRepairPreviewMode = false; syncSeamToggleUi(); });
  q<HTMLButtonElement>('seamPreviewProcessed').addEventListener('click', () => { seamRepairPreviewMode = true; syncSeamToggleUi(); });
  ['edgeBleedPx','edgeFeatherPx','jointOverlapPx','seamBlendStrength'].forEach((id)=> q<HTMLInputElement>(id).addEventListener('input', (e)=> { (seamRepairSettings as any)[id] = Number((e.target as HTMLInputElement).value); seamLayersNeedRebuild = id === 'edgeBleedPx' || id === 'edgeFeatherPx'; markStale(); }));
  q<HTMLButtonElement>('strongSeamTest').addEventListener('click', () => { seamRepairSettings.edgeBleedPx = 4; seamRepairSettings.edgeFeatherPx = 2; seamRepairSettings.jointOverlapPx = 12; seamRepairSettings.seamBlendStrength = 100; seamLayersNeedRebuild = true; markStale(); });
  q<HTMLButtonElement>('resetSeamSettings').addEventListener('click', () => { seamRepairSettings = { ...defaultSeamRepairSettings }; seamLayersNeedRebuild = true; markStale(); syncSeamToggleUi(); });
  syncSeamToggleUi();
  updateExportButtonState();
  };

  const selfCheck = () => {
    const shellError = q<HTMLDivElement>('shellError');
    const missing = ['file', 'loadProject', 'saveProject', 'workspace', 'modeMask', 'partChips', 'generateButton', 'generateButtonExport', 'pngButton', 'jsonButton', 'preview', 'renderReport'].filter((id) => !root.querySelector(`#${id}`));
    if (missing.length) { shellError.hidden = false; shellError.textContent = `UI shell error: missing ${missing.join(', ')}`; console.error(shellError.textContent); }
  };

  const ensureMaskCanvases = () => { if (!state.analysis) return; for (const p of parts) { if (!p.maskCanvas) { p.maskCanvas = document.createElement('canvas'); p.maskCanvas.width = state.analysis.width; p.maskCanvas.height = state.analysis.height; } if (!overlayCache.has(p.name)) overlayCache.set(p.name, { canvas: null, dirty: true, lastColor: p.color, lastOpacity: overlayOpacity }); } };
  const refreshSaveProjectEnabled = () => {
    const canSave = !!(sourceImageDataUrl && state.analysis);
    q<HTMLButtonElement>('saveProject').disabled = !canSave;
  };
  const markPartDirty = (name: string) => { const e = overlayCache.get(name); if (e) e.dirty = true; seamLayersNeedRebuild = true; rawExtractedPartLayers.clear(); processedPartLayers.clear(); markStale(); };
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
    if (!rawExtractedPartLayers.size) {
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
    rawExtractedPartLayers.clear();
    for (const part of parts) {
      if (!part.visible || !part.maskCanvas || !hasMaskPixels(part.maskCanvas)) continue;
      const layer = document.createElement('canvas');
      layer.width = state.analysis.width; layer.height = state.analysis.height;
      const layerCtx = layer.getContext('2d')!; layerCtx.drawImage(sourceCanvas,0,0); layerCtx.globalCompositeOperation = 'destination-in'; layerCtx.drawImage(part.maskCanvas,0,0); layerCtx.globalCompositeOperation = 'source-over';
      rawExtractedPartLayers.set(part.name, layer);
    }
    rebuildProcessedPartLayers();
    if (!rawExtractedPartLayers.has(selectedPartLayerName)) selectedPartLayerName = parts[0]?.name ?? selectedPartLayerName;
    setStatus(`Built ${rawExtractedPartLayers.size} part layer(s).`);
  };
  const getRecommendedPreset = (): { label: string; width: number; height: number } => {
    if (animationMode === 'part-based-small-walk') {
      const heavyWalkMotion = walkSettings.walkIntensity > 1.1 || walkSettings.armSwing > 1.1;
      if (heavyWalkMotion) return { label: extremeMotionPresetLabel, width: 4096, height: 4096 };
      return { label: largeMotionPresetLabel, width: 3072, height: 3072 };
    }
    return { label: preferredProductionPresetLabel, width: 2048, height: 2048 };
  };
  const syncRecommendedPreset = (applyAsDefault = false) => {
    const recommendation = getRecommendedPreset();
    recommendedPresetLabel = recommendation.label;
    recommendedCellWidth = recommendation.width;
    recommendedCellHeight = recommendation.height;
    if (applyAsDefault) {
      state.cellWidth = recommendation.width;
      state.cellHeight = recommendation.height;
      selectedPresetLabel = recommendation.label;
      q<HTMLInputElement>('cellWidth').value = String(recommendation.width);
      q<HTMLInputElement>('cellHeight').value = String(recommendation.height);
    }
  };

  const sourcePointFromEvent = (evt: PointerEvent): Point | null => {
    if (!state.analysis) return null;
    const p = getCanvasPointFromPointerEvent(evt, workspace);
    return { x: clamp(Math.round((p.x - workspaceTransform.offsetX) / workspaceTransform.scale), 0, state.analysis.width - 1), y: clamp(Math.round((p.y - workspaceTransform.offsetY) / workspaceTransform.scale), 0, state.analysis.height - 1) };
  };
  const scheduleWorkspaceRender = () => { if (renderRaf !== null) return; renderRaf = requestAnimationFrame(() => { renderRaf = null; renderWorkspace(); }); };
  const setFinePointerFromEvent = (evt: PointerEvent, sourcePoint?: Point | null) => {
    const canvasPoint = getCanvasPointFromPointerEvent(evt, workspace);
    const nextSource = sourcePoint ?? sourcePointFromEvent(evt);
    if (!nextSource) return;
    finePointer = { active: true, canvasPoint, sourcePoint: nextSource };
  };
  const toggleFineMode = (force?: boolean) => {
    fineMode = force ?? !fineMode;
    if (!fineMode) finePointer.active = false;
    renderParts();
    scheduleWorkspaceRender();
  };

  const getTransform = (name: string) => {
    if (!partTransforms.has(name)) partTransforms.set(name, { rotationDeg: 0, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 });
    return partTransforms.get(name)!;
  };


  const applySimpleBleed = (layer: HTMLCanvasElement, bleedPx: number, featherPx: number) => {
    if (bleedPx <= 0 && featherPx <= 0) return layer;
    const out = document.createElement('canvas'); out.width = layer.width; out.height = layer.height;
    const octx = out.getContext('2d')!;
    for (let i = bleedPx; i > 0; i--) { octx.globalAlpha = 1 / Math.max(1, i); octx.drawImage(layer, -i, 0); octx.drawImage(layer, i, 0); octx.drawImage(layer, 0, -i); octx.drawImage(layer, 0, i); }
    octx.globalAlpha = 1; octx.drawImage(layer, 0, 0);
    if (featherPx > 0) { octx.globalCompositeOperation = 'destination-in'; octx.filter = `blur(${featherPx}px)`; octx.drawImage(layer, 0, 0); octx.filter = 'none'; octx.globalCompositeOperation = 'source-over'; }
    return out;
  };
  
  const getActivePartLayers = () => (seamRepairSettings.enabled ? processedPartLayers : rawExtractedPartLayers);
  const rebuildProcessedPartLayers = () => { processedPartLayers.clear(); for (const [name, layer] of rawExtractedPartLayers.entries()) processedPartLayers.set(name, applySimpleBleed(layer, seamRepairSettings.edgeBleedPx, seamRepairSettings.edgeFeatherPx)); seamLayersNeedRebuild = false; };
const seamJointPairs = new Set(['torso:front_arm','torso:rear_arm','torso:front_leg','torso:rear_leg','torso:head']);
  const shouldJointBlend = (a: string, b: string) => seamJointPairs.has(`${a}:${b}`) || seamJointPairs.has(`${b}:${a}`);

  const renderParts = () => {
    partChips.innerHTML = parts.map((p) => `<button class="partChip ${p.name === activePart ? 'active' : ''}" data-part="${p.name}"><span class="swatch" style="background:${p.color}"></span><span class="partName">${p.name}</span><span data-toggle-vis="${p.name}">${p.visible ? '👁' : '🚫'}</span></button>`).join('');
    ['brushAddMode','brushEraseMode','lassoAddMode','lassoEraseMode','setPivotMode','setFloorMode','transformPartMode'].forEach((id, i) => q<HTMLButtonElement>(id).classList.toggle('active', ['brush-add','brush-erase','lasso-add','lasso-erase','set-pivot','set-floor','transform-part'][i] === toolMode));
    q<HTMLButtonElement>('cancelLasso').disabled = lassoPoints.length === 0;
    q<HTMLButtonElement>('undoMaskAction').disabled = undoStack.length === 0;
    q<HTMLButtonElement>('fineModeToggle').textContent = `Fine: ${fineMode ? 'On' : 'Off'}`;
    q<HTMLButtonElement>('fineModeToggle').classList.toggle('active', fineMode);
    q<HTMLButtonElement>('fineModeExit').hidden = !fineMode;
    q<HTMLSpanElement>('fineModeLabel').hidden = !fineMode;
    brushSizeValue.textContent = String(brushSize); overlayOpacityValue.textContent = `${Math.round(overlayOpacity * 100)}%`;
    const pivot = pivots.get(activePart);
    const floor = floorContacts.get(activePart);
    const transform = getTransform(activePart);
    const layerReadout = getCompositePartsInDrawOrder().map((part) => part.name).join(' → ');
    q<HTMLDivElement>('partInfo').innerHTML = `<strong>${activePart}</strong> · pivot: ${pivot ? `${pivot.x},${pivot.y}` : '—'} · floor: ${floor ? `${floor.x},${floor.y}` : '—'} · rot ${transform.rotationDeg.toFixed(0)}°<br/><small>Layer order: ${layerReadout}</small>`;
    updateStatusRow();
    const panel = q<HTMLDivElement>('transformPanel');
    panel.hidden = toolMode !== 'transform-part' || shellMode !== 'rig';
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

    if (fineMode && finePointer.active) {
      const loupeRadius = 78;
      const zoom = 4;
      const sourceSpan = (loupeRadius * 2) / zoom;
      const sourceX = clamp(finePointer.sourcePoint.x - sourceSpan / 2, 0, state.analysis.width - sourceSpan);
      const sourceY = clamp(finePointer.sourcePoint.y - sourceSpan / 2, 0, state.analysis.height - sourceSpan);
      const targetX = clamp(finePointer.canvasPoint.x + 95, loupeRadius + 8, workspace.width - loupeRadius - 8);
      const targetY = clamp(finePointer.canvasPoint.y - 95, loupeRadius + 8, workspace.height - loupeRadius - 8);
      const activePartColor = parts.find((part) => part.name === activePart)?.color ?? '#17c8ff';
      ctx.save();
      ctx.beginPath();
      ctx.arc(targetX, targetY, loupeRadius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(workspace, sourceX * workspaceTransform.scale + workspaceTransform.offsetX, sourceY * workspaceTransform.scale + workspaceTransform.offsetY, sourceSpan * workspaceTransform.scale, sourceSpan * workspaceTransform.scale, targetX - loupeRadius, targetY - loupeRadius, loupeRadius * 2, loupeRadius * 2);
      ctx.restore();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#111926';
      ctx.beginPath();
      ctx.arc(targetX, targetY, loupeRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = activePartColor;
      ctx.beginPath();
      ctx.arc(targetX, targetY, loupeRadius - 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#17c8ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(targetX - 10, targetY);
      ctx.lineTo(targetX + 10, targetY);
      ctx.moveTo(targetX, targetY - 10);
      ctx.lineTo(targetX, targetY + 10);
      ctx.stroke();
      ctx.fillStyle = activePartColor;
      ctx.beginPath();
      ctx.arc(targetX, targetY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
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

  const generateStripAndPreview = () => {
    if (!image || !state.analysis) return;
    if ((animationMode === 'part-based-idle' || animationMode === 'part-based-small-walk' || animationMode === 'part-based-attack') && !rawExtractedPartLayers.size) { setStatus('Build Part Layers first.', true); return; }
    if (seamLayersNeedRebuild) { setStatus('Rebuild Part Layers to apply edge bleed/feather changes.'); rebuildProcessedPartLayers(); }
    const activeLayers = getActivePartLayers();
    const plan = createRenderPlan(state.analysis, state.cellWidth, state.cellHeight, state.frameCount);
    const canvas = document.createElement('canvas'); canvas.width = state.cellWidth * state.frameCount; canvas.height = state.cellHeight;
    const ctx = canvas.getContext('2d')!;
    const frameCanvas = document.createElement('canvas'); frameCanvas.width = state.cellWidth; frameCanvas.height = state.cellHeight;
    const frameCtx = frameCanvas.getContext('2d')!;
    const frameBounds: FrameBoundsReport[] = [];
    const safePaddingXPercent = 0.08;
    const safePaddingYPercent = 0.06;
    const marginWarnThreshold = state.cellWidth * 0.05;
    const compileWarnings = [...plan.warnings];
    const drawFrame = (frameIndex: number, renderScale: number) => {
      frameCtx.clearRect(0, 0, state.cellWidth, state.cellHeight);
      const t = idleTransform(frameIndex, state.frameCount);
      if (animationMode === 'whole-sprite-idle') {
        const pivotX = state.analysis!.sourceBounds.x + state.analysis!.sourceBounds.width / 2;
        frameCtx.save(); frameCtx.translate(state.cellWidth / 2, plan.baseFloor + t.bobY * renderScale); frameCtx.scale(renderScale * t.scale, renderScale * t.scale); frameCtx.drawImage(image!, -pivotX, -state.analysis!.floorY); frameCtx.restore();
        return;
      }
      const intensity = idleSettings.overallIntensity;
      const phase = (frameIndex / state.frameCount) * Math.PI * 2;
      const walkPhase = (frameIndex / state.frameCount) * Math.PI * 2;
      for (const part of getCompositePartsInDrawOrder()) {
        if (!part.visible) continue;
        const layer = (seamRepairPreviewMode ? processedPartLayers : rawExtractedPartLayers).get(part.name);
        if (!layer) continue;
        const fallbackPivot = { x: layer.width / 2, y: layer.height / 2 };
        let partPivot = pivots.get(part.name) ?? fallbackPivot;
        if (part.name === 'front_arm' && !pivots.has(part.name)) {
          const armBounds = findAlphaBounds(layer);
          if (armBounds) {
            partPivot = {
              x: armBounds.minX + (armBounds.maxX - armBounds.minX) * 0.5,
              y: armBounds.minY + (armBounds.maxY - armBounds.minY) * 0.22,
            };
          }
        }
        const role = part.name;
        let bobY = 0; let rot = 0; let sx = 1; let sy = 1; let driftX = 0;
        if (animationMode === 'part-based-small-walk') {
          const walkI = walkSettings.walkIntensity; const stride = walkSettings.strideWidth; const swing = walkSettings.armSwing; const crossing = walkSettings.legCrossing; const hip = walkSettings.hipSway; const lock = walkSettings.footLockStrength;
          const legPhase = role === 'rear_leg' ? walkPhase + Math.PI : walkPhase;
          const armPhase = role === 'front_arm' ? walkPhase + Math.PI : role === 'rear_arm' ? walkPhase : walkPhase + 0.4;
          if (role === 'torso') { driftX = Math.sin(walkPhase) * 1.8 * hip * walkI; bobY = Math.cos(walkPhase * 2) * 1.4 * walkI; rot = Math.sin(walkPhase) * 1.2 * hip * walkI; }
          else if (role === 'head' || role === 'horns') { driftX = Math.sin(walkPhase - 0.35) * 1.1 * hip * walkI; bobY = Math.cos(walkPhase * 2 - 0.35) * 0.9 * walkI; rot = Math.sin(walkPhase - 0.6) * 0.8 * walkI; }
          else if (role === 'front_leg' || role === 'rear_leg') { rot = Math.sin(legPhase) * (8 + 8 * stride) * walkI; driftX = Math.sin(legPhase) * (1.5 + 2.2 * stride) * (1 - crossing * 0.7) * walkI; bobY = Math.max(0, Math.cos(legPhase)) * 1.4 * (1 - lock) * walkI; }
          else if (role === 'front_arm' || role === 'rear_arm') { rot = Math.sin(armPhase) * (6 + 10 * swing) * walkI; driftX = Math.sin(armPhase) * 1.2 * swing * walkI; }
          else if (role === 'tail' || role === 'extra_01') { rot = Math.sin(walkPhase - 0.7) * 2.2 * walkI; bobY = Math.sin(walkPhase - 0.5) * 0.8 * walkI; }
        } else if (animationMode === 'part-based-attack') {
          const attackT = state.frameCount <= 1 ? 0 : frameIndex / (state.frameCount - 1);
          const windup = Math.sin(Math.min(1, attackT * 2) * Math.PI * 0.5);
          const strike = Math.sin(Math.min(1, attackT * 1.25) * Math.PI);
          const recoil = attackT > 0.75 ? Math.sin(((attackT - 0.75) / 0.25) * Math.PI * 0.5) : 0;
          const intensityAttack = attackSettings.attackIntensity;
          const reach = attackSettings.attackReach;
          const lean = attackSettings.torsoLean;
          const swing = attackSettings.armSwing;
          const recoilAmt = attackSettings.recoilAmount;
          if (attackSettings.attackStyle === 'overhead-chop') {
            const chopDown = Math.sin(Math.min(1, Math.max(0, (attackT - 0.2) / 0.65)) * Math.PI * 0.5);
            const chopLift = 1 - Math.sin(Math.min(1, Math.max(0, (attackT - 0.18) / 0.52)) * Math.PI * 0.5);
            if (role === 'torso') { driftX = (chopDown * 4.8 * reach - recoil * 3.4 * recoilAmt) * intensityAttack; bobY = -(chopDown * 1.1 + chopLift * 0.3) * intensityAttack; rot = (chopDown * 3.4 * lean - recoil * 3.2 * recoilAmt) * intensityAttack; }
            else if (role === 'head' || role === 'horns') { driftX = (chopDown * 2.4 * reach - recoil * 1.6 * recoilAmt) * intensityAttack; bobY = -(chopDown * 0.7 + chopLift * 0.2) * intensityAttack; rot = (chopDown * 1.9 * lean - recoil * 1.4 * recoilAmt) * intensityAttack; }
            else if (role === 'front_arm') { driftX = (-chopLift * 1.2 + chopDown * 5.8 * reach - recoil * 3.8 * recoilAmt) * intensityAttack; bobY = -(chopLift * 2.4 + chopDown * 0.4) * intensityAttack; rot = (chopLift * attackSettings.chopRaiseAngle * swing * attackSettings.chopArcAmount - chopDown * attackSettings.chopDownAngle * swing - recoil * 14 * recoilAmt) * intensityAttack; }
            else if (role === 'rear_arm') { driftX = (-chopDown * 1.4 * reach + recoil * 1.8 * recoilAmt) * intensityAttack; rot = (chopLift * 3 - chopDown * 7 * swing + recoil * 8 * recoilAmt) * intensityAttack; }
            else if (role === 'tail' || role === 'extra_01') { rot = (-chopDown * 1.8 + recoil * 2.3 * recoilAmt) * intensityAttack; driftX = (-chopDown * 1.2 + recoil * 1.4) * intensityAttack; }
            else if (role === 'front_leg' || role === 'rear_leg') { bobY = Math.max(0, chopDown) * 0.25; rot = Math.sin(phase + (role === 'rear_leg' ? 0.6 : 0)) * 0.25; }
          } else if (role === 'torso') { driftX = (strike * 7 * reach - recoil * 4.5 * recoilAmt) * intensityAttack; bobY = -strike * 1.2 * intensityAttack; rot = (strike * 6 * lean - recoil * 5 * recoilAmt) * intensityAttack; }
          else if (role === 'head' || role === 'horns') { driftX = (strike * 3.2 * reach - recoil * 2.8 * recoilAmt) * intensityAttack; bobY = -strike * 0.8 * intensityAttack; rot = (strike * 2.2 * lean - recoil * 1.8 * recoilAmt) * intensityAttack; }
          else if (role === 'front_arm') { driftX = (windup * 2 + strike * 8 * reach - recoil * 5 * recoilAmt) * intensityAttack; bobY = -strike * 0.5 * intensityAttack; rot = (-windup * 10 + strike * 28 * swing - recoil * 18 * recoilAmt) * intensityAttack; }
          else if (role === 'rear_arm') { driftX = (-strike * 2.2 * reach + recoil * 2.5 * recoilAmt) * intensityAttack; rot = (windup * 4 - strike * 8 * swing + recoil * 10 * recoilAmt) * intensityAttack; }
          else if (role === 'tail' || role === 'extra_01') { rot = (-strike * 2.4 + recoil * 3.6 * recoilAmt) * intensityAttack; driftX = (-strike * 1.5 + recoil * 2.4) * intensityAttack; }
          else if (role === 'front_leg' || role === 'rear_leg') { bobY = Math.max(0, strike) * 0.2; rot = Math.sin(phase + (role === 'rear_leg' ? 0.6 : 0)) * 0.25; }
        } else if (role === 'torso') { const b = 0.01 * idleSettings.breathingAmount * intensity; sx += Math.sin(phase) * b; sy += Math.sin(phase) * b * 0.7; }
        else if (role === 'head' || role === 'horns') { bobY = Math.sin(phase + 0.5) * 2.5 * idleSettings.headSway * intensity; driftX = Math.sin(phase) * 1.6 * idleSettings.headSway * intensity; rot = Math.sin(phase + 1) * 1.5 * idleSettings.headSway * intensity; }
        else if (role === 'front_arm' || role === 'rear_arm' || role === 'tail' || role === 'extra_01') { bobY = Math.sin(phase + 0.8) * 1.6 * idleSettings.armDrift * intensity; driftX = Math.sin(phase + 0.4) * 1.2 * idleSettings.armDrift * intensity; rot = Math.sin(phase + 0.2) * 1.8 * idleSettings.armDrift * intensity; }
        else if (role === 'front_leg' || role === 'rear_leg') { bobY = Math.sin(phase) * 0.35 * intensity; rot = Math.sin(phase + 0.4) * 0.4 * intensity; }
        frameCtx.save(); frameCtx.translate(state.cellWidth / 2, plan.baseFloor); frameCtx.scale(renderScale, renderScale); frameCtx.translate(partPivot.x + driftX, partPivot.y + bobY - state.analysis!.floorY); frameCtx.rotate((rot * Math.PI) / 180); frameCtx.scale(sx, sy);
        if (seamRepairSettings.enabled && seamRepairSettings.gapFillEnabled && role !== 'torso') { frameCtx.globalAlpha = 0.35; frameCtx.drawImage(layer, -partPivot.x - seamRepairSettings.jointOverlapPx * 0.2, -partPivot.y); frameCtx.globalAlpha = 1; }
        frameCtx.drawImage(layer, -partPivot.x, -partPivot.y);
        if (seamRepairSettings.enabled && seamRepairSettings.seamBlendStrength > 0 && shouldJointBlend('torso', role)) { frameCtx.globalAlpha = seamRepairSettings.seamBlendStrength / 100; frameCtx.globalCompositeOperation = 'lighter'; frameCtx.drawImage(layer, -partPivot.x, -partPivot.y); frameCtx.globalCompositeOperation = 'source-over'; frameCtx.globalAlpha = 1; }
        frameCtx.restore();
      }
    };
    let envelope: MotionEnvelope | null = null;
    for (let i = 0; i < state.frameCount; i++) {
      drawFrame(i, plan.renderScale);
      const b = findAlphaBounds(frameCanvas);
      if (!b) continue;
      envelope = envelope ? { minX: Math.min(envelope.minX, b.minX), minY: Math.min(envelope.minY, b.minY), maxX: Math.max(envelope.maxX, b.maxX), maxY: Math.max(envelope.maxY, b.maxY), width: 0, height: 0, frameHits: envelope.frameHits + 1 } : { ...b, frameHits: 1 };
    }
    if (envelope) { envelope.width = envelope.maxX - envelope.minX + 1; envelope.height = envelope.maxY - envelope.minY + 1; }
    const safeAreaWidth = state.cellWidth * (1 - safePaddingXPercent * 2);
    const safeAreaHeight = state.cellHeight * (1 - safePaddingYPercent * 2);
    const fitScale = envelope ? Math.min(1, safeAreaWidth / Math.max(1, envelope.width), safeAreaHeight / Math.max(1, envelope.height)) : 1;
    const motionSafeScale = Number(fitScale.toFixed(4));
    const clippingPrevented = motionSafeScale < 0.999;
    if (clippingPrevented) compileWarnings.push(`Motion-safe fit applied: ${(motionSafeScale * 100).toFixed(1)}%.`);
    if (motionSafeScale < 0.85) compileWarnings.push('Motion requires heavy downscaling. Use a larger cell to preserve detail.');
    const finalRenderScale = plan.renderScale * motionSafeScale;
    for (let i = 0; i < state.frameCount; i++) {
      drawFrame(i, finalRenderScale);
      const bounds = findAlphaBounds(frameCanvas);
      let shiftX = 0;
      let shiftY = 0;
      let centerOffsetXBeforeCorrection = 0;
      let finalLeftMargin = 0;
      let finalRightMargin = 0;
      if (bounds) {
        const boundsCenterX = (bounds.minX + bounds.maxX) / 2;
        const cellCenterX = state.cellWidth / 2;
        centerOffsetXBeforeCorrection = boundsCenterX - cellCenterX;
        shiftX = Math.round(cellCenterX - boundsCenterX);
        shiftY = Math.round(plan.baseFloor - bounds.maxY);
        finalLeftMargin = bounds.minX + shiftX;
        finalRightMargin = state.cellWidth - 1 - (bounds.maxX + shiftX);
        if (Math.abs(finalLeftMargin - finalRightMargin) > marginWarnThreshold) {
          compileWarnings.push(`Frame ${i}: left/right margins differ by more than 5% of cell width.`);
        }
      }
      ctx.drawImage(frameCanvas, i * state.cellWidth + shiftX, shiftY);
      frameBounds.push({ frameIndex: i, alphaBounds: bounds, centerOffsetXBeforeCorrection: Number(centerOffsetXBeforeCorrection.toFixed(3)), finalLeftMargin: Number(finalLeftMargin.toFixed(3)), finalRightMargin: Number(finalRightMargin.toFixed(3)) });
    }
    stripCanvas = canvas; lastRenderPlan = plan; stalePreview = false;
    const recommendedCellWidth = envelope ? Math.ceil((envelope.width / Math.max(0.1, 1 - safePaddingXPercent * 2)) / 64) * 64 : state.cellWidth;
    const recommendedCellHeight = envelope ? Math.ceil((envelope.height / Math.max(0.1, 1 - safePaddingYPercent * 2)) / 64) * 64 : state.cellHeight;
    syncRecommendedPreset(false);
    exportMeta = { animationMode, partBasedIdle: animationMode === 'part-based-idle', idleSettings: { ...idleSettings }, walkSettings: { ...walkSettings }, attackSettings: { ...attackSettings }, seamRepairSettings: { ...seamRepairSettings }, frameCount: state.frameCount, cellWidth: state.cellWidth, cellHeight: state.cellHeight, stripWidth: canvas.width, stripHeight: canvas.height, floorY: plan.baseFloor, renderScale: Number(finalRenderScale.toFixed(4)), selectedPresetLabel, recommendedPresetLabel, warnings: compileWarnings, bleedRisk: plan.bleedRisk, frameBounds, motionEnvelope: envelope, motionSafeScale, clippingPrevented, recommendedCellWidth, recommendedCellHeight, leftMarginMin: Math.min(...frameBounds.map((r) => r.finalLeftMargin)), rightMarginMin: Math.min(...frameBounds.map((r) => r.finalRightMargin)), topMarginMin: envelope ? envelope.minY : 0, bottomMarginMin: envelope ? state.cellHeight - 1 - envelope.maxY : 0, processedLayersUsed: seamRepairSettings.enabled, seamRepairWarnings: seamLayersNeedRebuild ? ['Rebuild Part Layers to apply edge bleed/feather changes.'] : [] };
    renderReport.textContent = JSON.stringify(exportMeta, null, 2);
    renderReport.dataset.stale = 'false';
    updateExportButtonState();
    setStatus(`Generated strip ${canvas.width}x${canvas.height}`);
  };

  const startPreviewLoop = () => {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    let lastTs = 0; let frame = 0;
    const tick = (ts: number) => { const ctx = preview.getContext('2d')!; ctx.clearRect(0,0,preview.width,preview.height); if (previewMode === 'idle-strip') { if (stripCanvas && !stalePreview) { if (ts - lastTs > 180) { frame = (frame + 1) % state.frameCount; lastTs = ts; } const sx = frame * state.cellWidth; ctx.drawImage(stripCanvas, sx, 0, state.cellWidth, state.cellHeight, 0, 0, preview.width, preview.height); } } else { const scale = state.analysis ? Math.min(preview.width / state.analysis.width, preview.height / state.analysis.height, 1) : 1; const drawW = state.analysis ? state.analysis.width * scale : preview.width; const drawH = state.analysis ? state.analysis.height * scale : preview.height; const offsetX = (preview.width - drawW) / 2; const offsetY = (preview.height - drawH) / 2; if (previewMode === 'part-layer') { const selected = (seamRepairPreviewMode ? processedPartLayers : rawExtractedPartLayers).get(selectedPartLayerName); if (selected) ctx.drawImage(selected, offsetX, offsetY, drawW, drawH); } else if (previewMode === 'composite-parts') { if (!rawExtractedPartLayers.size) { ctx.fillStyle = '#b8d3ea'; ctx.font = '16px sans-serif'; ctx.fillText('Build Part Layers first.', 24, 40); } for (const part of getCompositePartsInDrawOrder()) { if (!part.visible) continue; const layer = (seamRepairPreviewMode ? processedPartLayers : rawExtractedPartLayers).get(part.name); if (!layer) continue; const t = getTransform(part.name); const pivot = pivots.get(part.name) ?? { x: layer.width / 2, y: layer.height / 2 }; const px = offsetX + pivot.x * scale; const py = offsetY + pivot.y * scale; ctx.save(); ctx.translate(px + t.translateX * scale, py + t.translateY * scale); ctx.rotate((t.rotationDeg * Math.PI) / 180); ctx.scale(t.scaleX, t.scaleY); ctx.drawImage(layer, -pivot.x * scale, -pivot.y * scale, drawW, drawH); if (part.name === activePart && toolMode === 'transform-part') { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.strokeRect(-pivot.x * scale, -pivot.y * scale, drawW, drawH); } ctx.restore(); } } } previewRaf = requestAnimationFrame(tick); };
    previewRaf = requestAnimationFrame(tick);
  };

  q<HTMLInputElement>('file').addEventListener('change', async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; image = await loadPngFromFile(file); sourceImageDataUrl = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(file); }); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image,0,0); state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0,0,c.width,c.height)); sourceQuality.textContent = `Source: ${state.analysis.width}x${state.analysis.height}\nFloorY: ${state.analysis.floorY}`; ensureMaskCanvases(); renderParts(); scheduleWorkspaceRender(); markStale(); setStatus(`Loaded ${file.name}`); q<HTMLSpanElement>('fileStat').textContent = `File: ${file.name}`; q<HTMLSpanElement>('dimensionsStat').textContent = `Dimensions: ${image.width}×${image.height}`; q<HTMLSpanElement>('savedStat').textContent = 'Loaded'; refreshSaveProjectEnabled(); });

  generateButton.addEventListener('click', generateStripAndPreview);
  
  const syncSeamToggleUi = () => {
    q<HTMLButtonElement>('seamRepairOff').classList.toggle('active', !seamRepairSettings.enabled);
    q<HTMLButtonElement>('seamRepairOn').classList.toggle('active', seamRepairSettings.enabled);
    q<HTMLButtonElement>('gapFillOff').classList.toggle('active', !seamRepairSettings.gapFillEnabled);
    q<HTMLButtonElement>('gapFillOn').classList.toggle('active', seamRepairSettings.gapFillEnabled);
    q<HTMLButtonElement>('seamPreviewRaw').classList.toggle('active', !seamRepairPreviewMode);
    q<HTMLButtonElement>('seamPreviewProcessed').classList.toggle('active', seamRepairPreviewMode);
  };
const syncShellModeControls = () => {
    ['modeMask', 'modeRig', 'modeAnimate', 'modeExport'].forEach((id, index) => q<HTMLButtonElement>(id).classList.toggle('active', ['mask', 'rig', 'animate', 'export'][index] === shellMode));
    q<HTMLDivElement>('maskControls').hidden = shellMode !== 'mask';
    q<HTMLDivElement>('rigControls').hidden = shellMode !== 'rig';
    q<HTMLDivElement>('animateControls').hidden = shellMode !== 'animate';
    q<HTMLDivElement>('exportControls').hidden = shellMode !== 'export';
    q<HTMLDivElement>('transformPanel').hidden = shellMode !== 'rig' || toolMode !== 'transform-part';
    updateStatusRow();
  };
  const setShellMode = (mode: ShellMode) => {
    if (shellMode === mode) return;
    shellMode = mode;
    if (isPainting && activePointerId !== null) {
      try {
        workspace.releasePointerCapture(activePointerId);
      } catch {}
    }
    isPainting = false;
    activePointerId = null;
    lastPaintPoint = null;
    lassoPoints = [];
    syncShellModeControls();
    renderParts();
    scheduleWorkspaceRender();
  };
  const syncIdleReadout = () => {
    q<HTMLSpanElement>('breathingAmountValue').textContent = idleSettings.breathingAmount.toFixed(2);
    q<HTMLSpanElement>('headSwayValue').textContent = idleSettings.headSway.toFixed(2);
    q<HTMLSpanElement>('armDriftValue').textContent = idleSettings.armDrift.toFixed(2);
    q<HTMLSpanElement>('overallIntensityValue').textContent = idleSettings.overallIntensity.toFixed(2);
    q<HTMLButtonElement>('wholeIdleMode').classList.toggle('active', animationMode === 'whole-sprite-idle');
    q<HTMLButtonElement>('partIdleMode').classList.toggle('active', animationMode === 'part-based-idle');
    q<HTMLButtonElement>('partWalkMode').classList.toggle('active', animationMode === 'part-based-small-walk');
    q<HTMLButtonElement>('partAttackMode').classList.toggle('active', animationMode === 'part-based-attack');
    q<HTMLDivElement>('idleControlGrid').hidden = animationMode === 'part-based-small-walk' || animationMode === 'part-based-attack';
    q<HTMLDivElement>('walkControlGrid').hidden = animationMode !== 'part-based-small-walk';
    q<HTMLDivElement>('attackStyleRow').hidden = animationMode !== 'part-based-attack';
    q<HTMLDivElement>('attackControlGrid').hidden = animationMode !== 'part-based-attack';
    q<HTMLButtonElement>('attackStyleForward').classList.toggle('active', attackSettings.attackStyle === 'forward-strike');
    q<HTMLButtonElement>('attackStyleChop').classList.toggle('active', attackSettings.attackStyle === 'overhead-chop');
    q<HTMLSpanElement>('walkIntensityValue').textContent = walkSettings.walkIntensity.toFixed(2);
    q<HTMLSpanElement>('strideWidthValue').textContent = walkSettings.strideWidth.toFixed(2);
    q<HTMLSpanElement>('legCrossingValue').textContent = walkSettings.legCrossing.toFixed(2);
    q<HTMLSpanElement>('hipSwayValue').textContent = walkSettings.hipSway.toFixed(2);
    q<HTMLSpanElement>('armSwingValue').textContent = walkSettings.armSwing.toFixed(2);
    q<HTMLSpanElement>('footLockStrengthValue').textContent = walkSettings.footLockStrength.toFixed(2);
    q<HTMLSpanElement>('attackIntensityValue').textContent = attackSettings.attackIntensity.toFixed(2);
    q<HTMLSpanElement>('attackReachValue').textContent = attackSettings.attackReach.toFixed(2);
    q<HTMLSpanElement>('torsoLeanValue').textContent = attackSettings.torsoLean.toFixed(2);
    q<HTMLSpanElement>('attackArmSwingValue').textContent = attackSettings.armSwing.toFixed(2);
    q<HTMLSpanElement>('recoilAmountValue').textContent = attackSettings.recoilAmount.toFixed(2);
  };
  syncRecommendedPreset(false);

  q<HTMLButtonElement>('modeMask').addEventListener('pointerup', () => setShellMode('mask'));
  q<HTMLButtonElement>('modeRig').addEventListener('pointerup', () => setShellMode('rig'));
  q<HTMLButtonElement>('modeAnimate').addEventListener('pointerup', () => setShellMode('animate'));
  q<HTMLButtonElement>('modeExport').addEventListener('pointerup', () => setShellMode('export'));
  q<HTMLButtonElement>('generateButtonExport').addEventListener('click', generateStripAndPreview);
  q<HTMLButtonElement>('wholeIdleMode').addEventListener('click', () => { animationMode = 'whole-sprite-idle'; syncRecommendedPreset(false); markStale(); syncIdleReadout(); });
  q<HTMLButtonElement>('partIdleMode').addEventListener('click', () => { animationMode = 'part-based-idle'; syncRecommendedPreset(false); markStale(); syncIdleReadout(); });
  q<HTMLButtonElement>('partWalkMode').addEventListener('click', () => { animationMode = 'part-based-small-walk'; syncRecommendedPreset(true); markStale(); syncIdleReadout(); });
  q<HTMLButtonElement>('partAttackMode').addEventListener('click', () => { animationMode = 'part-based-attack'; syncRecommendedPreset(false); markStale(); syncIdleReadout(); });
  q<HTMLInputElement>('breathingAmount').addEventListener('input', (e) => { idleSettings.breathingAmount = Number((e.target as HTMLInputElement).value); markStale(); syncIdleReadout(); });
  q<HTMLInputElement>('headSway').addEventListener('input', (e) => { idleSettings.headSway = Number((e.target as HTMLInputElement).value); markStale(); syncIdleReadout(); });
  q<HTMLInputElement>('armDrift').addEventListener('input', (e) => { idleSettings.armDrift = Number((e.target as HTMLInputElement).value); markStale(); syncIdleReadout(); });
  q<HTMLInputElement>('overallIntensity').addEventListener('input', (e) => { idleSettings.overallIntensity = Number((e.target as HTMLInputElement).value); markStale(); syncIdleReadout(); });
  q<HTMLButtonElement>('resetIdleSettings').addEventListener('click', () => { idleSettings = { ...defaultIdleSettings }; q<HTMLInputElement>('breathingAmount').value = '1'; q<HTMLInputElement>('headSway').value = '1'; q<HTMLInputElement>('armDrift').value = '1'; q<HTMLInputElement>('overallIntensity').value = '1'; markStale(); syncIdleReadout(); });
  q<HTMLButtonElement>('resetWalkSettings').addEventListener('click', () => { walkSettings = { ...defaultWalkSettings }; q<HTMLInputElement>('walkIntensity').value = '1'; q<HTMLInputElement>('strideWidth').value = '1'; q<HTMLInputElement>('legCrossing').value = '0.25'; q<HTMLInputElement>('hipSway').value = '1'; q<HTMLInputElement>('armSwing').value = '1'; q<HTMLInputElement>('footLockStrength').value = '0.85'; markStale(); syncIdleReadout(); });
  ['walkIntensity','strideWidth','legCrossing','hipSway','armSwing','footLockStrength'].forEach((key)=> q<HTMLInputElement>(key).addEventListener('input', (e)=> { (walkSettings as any)[key] = Number((e.target as HTMLInputElement).value); syncRecommendedPreset(false); markStale(); syncIdleReadout(); }));
  q<HTMLButtonElement>('resetAttackSettings').addEventListener('click', () => { attackSettings = { ...defaultAttackSettings }; q<HTMLInputElement>('attackIntensity').value = '1'; q<HTMLInputElement>('attackReach').value = '1'; q<HTMLInputElement>('torsoLean').value = '1'; q<HTMLInputElement>('attackArmSwing').value = '1'; q<HTMLInputElement>('recoilAmount').value = '1'; markStale(); syncIdleReadout(); });
  q<HTMLButtonElement>('attackStyleForward').addEventListener('click', () => { attackSettings.attackStyle = 'forward-strike'; markStale(); syncIdleReadout(); });
  q<HTMLButtonElement>('attackStyleChop').addEventListener('click', () => { attackSettings.attackStyle = 'overhead-chop'; markStale(); syncIdleReadout(); });
  [['attackIntensity','attackIntensity'],['attackReach','attackReach'],['torsoLean','torsoLean'],['attackArmSwing','armSwing'],['recoilAmount','recoilAmount']].forEach(([id,key])=> q<HTMLInputElement>(id).addEventListener('input', (e)=> { (attackSettings as any)[key] = Number((e.target as HTMLInputElement).value); markStale(); syncIdleReadout(); }));
  q<HTMLButtonElement>('buildPartLayersButton').addEventListener('click', () => { buildPartLayers(); });
  q<HTMLButtonElement>('autoPlacePivotsButton').addEventListener('click', runAutoRigHints);
  q<HTMLButtonElement>('exportSelectedPartButton').addEventListener('click', () => { const selected = (seamRepairPreviewMode ? processedPartLayers : rawExtractedPartLayers).get(selectedPartLayerName); if (!selected) return; selected.toBlob((blob) => blob && downloadBlob(`${selectedPartLayerName}.png`, blob)); });
  q<HTMLSelectElement>('previewMode').addEventListener('change', (e) => { previewMode = (e.target as HTMLSelectElement).value as PreviewMode; });
  pngButton.addEventListener('click', () => {
    if (!stripCanvas || stalePreview) {
      setStatus('Generate a strip before exporting.', true);
      return;
    }
    stripCanvas.toBlob((blob) => blob && downloadBlob('sprite-strip.png', blob));
  });
  jsonButton.addEventListener('click', () => {
    if (!exportMeta || stalePreview) {
      setStatus('Generate a strip before exporting.', true);
      return;
    }
    downloadBlob('sprite-strip-metadata.json', new Blob([JSON.stringify(exportMeta, null, 2)], { type: 'application/json' }));
  });

  q<HTMLSelectElement>('frameCount').addEventListener('change', (e) => { state.frameCount = Number((e.target as HTMLSelectElement).value) as 5 | 6; markStale(); });
  q<HTMLInputElement>('cellWidth').addEventListener('input', (e) => { state.cellWidth = Number((e.target as HTMLInputElement).value); selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight); markStale(); });
  q<HTMLInputElement>('cellHeight').addEventListener('input', (e) => { state.cellHeight = Number((e.target as HTMLInputElement).value); selectedPresetLabel = findPresetLabel(state.cellWidth, state.cellHeight); markStale(); });
  const presetRow = q<HTMLDivElement>('presetRow'); presetRow.innerHTML = exportSizePresets.map((p) => `<button data-preset="${p.label}">${p.label}</button>`).join('');
  presetRow.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-preset]'); if (!b) return; const p = exportSizePresets.find((x) => x.label === b.dataset.preset)!; state.cellWidth = p.width; state.cellHeight = p.height; q<HTMLInputElement>('cellWidth').value = String(p.width); q<HTMLInputElement>('cellHeight').value = String(p.height); selectedPresetLabel = p.label; markStale(); });

  partChips.addEventListener('click', (e) => { const toggle = (e.target as HTMLElement).closest('[data-toggle-vis]') as HTMLElement | null; if (toggle) { const p = parts.find((x) => x.name === toggle.dataset.toggleVis); if (p) p.visible = !p.visible; renderParts(); scheduleWorkspaceRender(); return; } const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-part]'); if (chip?.dataset.part) { activePart = chip.dataset.part; selectedPartLayerName = chip.dataset.part; } renderParts(); });
  q<HTMLInputElement>('brushSize').addEventListener('input', (e) => { brushSize = Number((e.target as HTMLInputElement).value); renderParts(); });
  q<HTMLInputElement>('overlayOpacity').addEventListener('input', (e) => { overlayOpacity = Number((e.target as HTMLInputElement).value); parts.forEach((p) => markPartDirty(p.name)); renderParts(); scheduleWorkspaceRender(); });
  q<HTMLButtonElement>('brushAddMode').addEventListener('click', () => { toolMode = 'brush-add'; renderParts(); }); q<HTMLButtonElement>('brushEraseMode').addEventListener('click', () => { toolMode = 'brush-erase'; renderParts(); }); q<HTMLButtonElement>('lassoAddMode').addEventListener('click', () => { toolMode = 'lasso-add'; renderParts(); }); q<HTMLButtonElement>('lassoEraseMode').addEventListener('click', () => { toolMode = 'lasso-erase'; renderParts(); }); q<HTMLButtonElement>('setPivotMode').addEventListener('click', () => { toolMode = 'set-pivot'; lassoPoints = []; renderParts(); scheduleWorkspaceRender(); }); q<HTMLButtonElement>('setFloorMode').addEventListener('click', () => { toolMode = 'set-floor'; lassoPoints = []; renderParts(); scheduleWorkspaceRender(); }); q<HTMLButtonElement>('transformPartMode').addEventListener('click', () => { toolMode = 'transform-part'; renderParts(); });
  const pushUndoSnapshot = (partName: string, maskCanvas: HTMLCanvasElement) => {
    undoStack.push({ partName, imageData: maskCanvas.getContext('2d')!.getImageData(0, 0, maskCanvas.width, maskCanvas.height) });
    if (undoStack.length > maxUndoEntries) undoStack.shift();
  };
  q<HTMLButtonElement>('cancelLasso').addEventListener('click', () => { lassoPoints = []; renderParts(); scheduleWorkspaceRender(); }); q<HTMLButtonElement>('undoMaskAction').addEventListener('click', () => { const entry = undoStack.pop(); if (!entry) return; const part = parts.find((p) => p.name === entry.partName); if (!part?.maskCanvas) return; part.maskCanvas.getContext('2d')!.putImageData(entry.imageData, 0, 0); markPartDirty(part.name); renderParts(); scheduleWorkspaceRender(); });

  const paint = (from: Point, to: Point) => { const part = parts.find((p) => p.name === activePart); if (!part?.maskCanvas) return; const ctx = part.maskCanvas.getContext('2d')!; ctx.globalCompositeOperation = toolMode === 'brush-add' ? 'source-over' : 'destination-out'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brushSize * 2; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.beginPath(); ctx.arc(to.x, to.y, brushSize,0,Math.PI*2); ctx.fill(); markPartDirty(part.name); };
  const commitLasso = () => { const part = parts.find((p) => p.name === activePart); if (!part?.maskCanvas || lassoPoints.length < 3) { lassoPoints = []; return; } pushUndoSnapshot(part.name, part.maskCanvas); const ctx = part.maskCanvas.getContext('2d')!; ctx.globalCompositeOperation = toolMode === 'lasso-add' ? 'source-over' : 'destination-out'; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(lassoPoints[0]!.x,lassoPoints[0]!.y); for (let i=1;i<lassoPoints.length;i++) ctx.lineTo(lassoPoints[i]!.x,lassoPoints[i]!.y); ctx.closePath(); ctx.fill(); lassoPoints = []; markPartDirty(part.name); };
  const finish = (evt: PointerEvent) => { if (activePointerId !== evt.pointerId) return; workspace.releasePointerCapture(evt.pointerId); if (toolMode.startsWith('lasso-')) commitLasso(); isPainting = false; activePointerId = null; lastPaintPoint = null; renderParts(); scheduleWorkspaceRender(); };
  workspace.addEventListener('pointerdown', (evt) => { if (!state.analysis) return; evt.preventDefault(); const p = sourcePointFromEvent(evt); if (!p) return; setFinePointerFromEvent(evt, p); const now = Date.now(); if (!toolMode.startsWith('lasso-') && !isPainting && now - lastTapTime < 280) { toggleFineMode(); lastTapTime = 0; return; } lastTapTime = now; if (toolMode === 'set-pivot') { pivots.set(activePart, p); renderParts(); scheduleWorkspaceRender(); return; } if (toolMode === 'set-floor') { floorContacts.set(activePart, p); renderParts(); scheduleWorkspaceRender(); return; } if (toolMode === 'transform-part') return; workspace.setPointerCapture(evt.pointerId); isPainting = true; activePointerId = evt.pointerId; lastPaintPoint = p; const part = parts.find((partEntry) => partEntry.name === activePart); if (part?.maskCanvas && toolMode.startsWith('brush-')) { pushUndoSnapshot(part.name, part.maskCanvas); paint(p,p); } else lassoPoints = [p]; scheduleWorkspaceRender(); });
  workspace.addEventListener('pointermove', (evt) => { const p = sourcePointFromEvent(evt); if (!p) return; setFinePointerFromEvent(evt, p); if (isPainting && activePointerId === evt.pointerId && lastPaintPoint) { evt.preventDefault(); if (toolMode.startsWith('brush-')) { paint(lastPaintPoint,p); lastPaintPoint = p; } else lassoPoints.push(p); } scheduleWorkspaceRender(); });
  workspace.addEventListener('pointerup', finish); workspace.addEventListener('pointercancel', finish);
  workspace.addEventListener('pointerleave', () => { if (!isPainting) { finePointer.active = false; scheduleWorkspaceRender(); } });
  q<HTMLButtonElement>('fineModeToggle').addEventListener('click', () => toggleFineMode());
  q<HTMLButtonElement>('fineModeExit').addEventListener('click', () => toggleFineMode(false));

  q<HTMLButtonElement>('saveProject').addEventListener('click', () => { if (!state.analysis || !sourceImageDataUrl) { setStatus('Load or upload a sprite before saving project.', true); return; } const project: ProjectSaveData = { sourceImageDataUrl, sourceImageWidth: state.analysis.width, sourceImageHeight: state.analysis.height, sourceBounds: state.analysis.sourceBounds, floorY: state.analysis.floorY, parts: parts.map((p) => ({ name: p.name, visible: p.visible, color: p.color, maskDataUrl: p.maskCanvas?.toDataURL('image/png') ?? null })), pivots: Object.fromEntries(parts.map((p) => [p.name, pivots.get(p.name)])), floorContacts: Object.fromEntries(parts.map((p) => [p.name, floorContacts.get(p.name)])), transforms: Object.fromEntries(parts.map((p) => [p.name, getTransform(p.name)])), layerOrder: parts.map((p) => p.name), exportSettings: { frameCount: state.frameCount, cellWidth: state.cellWidth, cellHeight: state.cellHeight, selectedPresetLabel, recommendedPresetLabel, recommendedCellWidth, recommendedCellHeight, safePaddingXPercent: 0.08, safePaddingYPercent: 0.06 }, animationMode, idleSettings: { ...idleSettings }, walkSettings: { ...walkSettings }, attackSettings: { ...attackSettings }, seamRepairSettings: { ...seamRepairSettings }, activePart }; downloadBlob('sprite-rig-project.json', new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })); q<HTMLSpanElement>('savedStat').textContent = 'Saved'; setStatus('Project saved/downloaded.'); refreshSaveProjectEnabled(); });
  q<HTMLInputElement>('loadProject').addEventListener('change', async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; const parsed = JSON.parse(await file.text()) as ProjectSaveData; sourceImageDataUrl = parsed.sourceImageDataUrl; image = await loadPngFromFile(new File([await (await fetch(parsed.sourceImageDataUrl)).blob()], 'project.png', { type: 'image/png' })); const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.drawImage(image, 0, 0); state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0,0,c.width,c.height)); state.frameCount = parsed.exportSettings?.frameCount ?? state.frameCount; state.cellWidth = parsed.exportSettings?.cellWidth ?? state.cellWidth; state.cellHeight = parsed.exportSettings?.cellHeight ?? state.cellHeight; selectedPresetLabel = parsed.exportSettings?.selectedPresetLabel ?? findPresetLabel(state.cellWidth, state.cellHeight); recommendedPresetLabel = parsed.exportSettings?.recommendedPresetLabel ?? recommendedPresetLabel; recommendedCellWidth = parsed.exportSettings?.recommendedCellWidth ?? recommendedCellWidth; recommendedCellHeight = parsed.exportSettings?.recommendedCellHeight ?? recommendedCellHeight; applySavedLayerOrder(parsed.layerOrder); activePart = parsed.activePart ?? activePart; q<HTMLSelectElement>('frameCount').value = String(state.frameCount); q<HTMLInputElement>('cellWidth').value = String(state.cellWidth); q<HTMLInputElement>('cellHeight').value = String(state.cellHeight); for (const part of parts) { part.maskCanvas = document.createElement('canvas'); part.maskCanvas.width = state.analysis.width; part.maskCanvas.height = state.analysis.height; } for (const saved of parsed.parts) { const p = parts.find((x) => x.name === saved.name); if (!p) continue; p.visible = saved.visible; if (saved.maskDataUrl && p.maskCanvas) { const m = await loadPngFromFile(new File([await (await fetch(saved.maskDataUrl)).blob()], 'mask.png', { type: 'image/png' })); p.maskCanvas.getContext('2d')!.drawImage(m, 0, 0); } markPartDirty(p.name); } pivots.clear(); floorContacts.clear(); partTransforms.clear(); for (const part of parts) { const pv = parsed.pivots?.[part.name]; const fc = parsed.floorContacts?.[part.name]; const tf = parsed.transforms?.[part.name]; if (pv) pivots.set(part.name, pv); if (fc) floorContacts.set(part.name, fc); if (tf) partTransforms.set(part.name, tf); } animationMode = parsed.animationMode ?? 'whole-sprite-idle'; idleSettings = { ...defaultIdleSettings, ...parsed.idleSettings }; walkSettings = { ...defaultWalkSettings, ...parsed.walkSettings }; attackSettings = { ...defaultAttackSettings, ...parsed.attackSettings }; seamRepairSettings = { ...defaultSeamRepairSettings, ...parsed.seamRepairSettings }; q<HTMLInputElement>('breathingAmount').value = String(idleSettings.breathingAmount); q<HTMLInputElement>('headSway').value = String(idleSettings.headSway); q<HTMLInputElement>('armDrift').value = String(idleSettings.armDrift); q<HTMLInputElement>('overallIntensity').value = String(idleSettings.overallIntensity); q<HTMLInputElement>('walkIntensity').value = String(walkSettings.walkIntensity); q<HTMLInputElement>('strideWidth').value = String(walkSettings.strideWidth); q<HTMLInputElement>('legCrossing').value = String(walkSettings.legCrossing); q<HTMLInputElement>('hipSway').value = String(walkSettings.hipSway); q<HTMLInputElement>('armSwing').value = String(walkSettings.armSwing); q<HTMLInputElement>('footLockStrength').value = String(walkSettings.footLockStrength); q<HTMLInputElement>('attackIntensity').value = String(attackSettings.attackIntensity); q<HTMLInputElement>('attackReach').value = String(attackSettings.attackReach); q<HTMLInputElement>('torsoLean').value = String(attackSettings.torsoLean); q<HTMLInputElement>('attackArmSwing').value = String(attackSettings.armSwing); q<HTMLInputElement>('recoilAmount').value = String(attackSettings.recoilAmount); syncRecommendedPreset(false); syncIdleReadout(); syncShellModeControls(); renderParts(); scheduleWorkspaceRender(); setStatus('Loaded project JSON.'); q<HTMLSpanElement>('fileStat').textContent = `File: ${file.name}`; q<HTMLSpanElement>('dimensionsStat').textContent = `Dimensions: ${image.width}×${image.height}`; q<HTMLSpanElement>('savedStat').textContent = 'Loaded'; refreshSaveProjectEnabled(); });


  q<HTMLInputElement>('rotationDeg').addEventListener('input', (e) => { const t = getTransform(activePart); t.rotationDeg = Number((e.target as HTMLInputElement).value); renderParts(); });
  q<HTMLInputElement>('uniformScale').addEventListener('input', (e) => { const t = getTransform(activePart); const v = Number((e.target as HTMLInputElement).value); t.scaleX = v; t.scaleY = v; renderParts(); });
  const nudgeBy = (dx: number, dy: number) => { const t = getTransform(activePart); t.translateX += dx; t.translateY += dy; renderParts(); };
  q<HTMLButtonElement>('nudgeLeft').addEventListener('click', () => nudgeBy(-2, 0));
  q<HTMLButtonElement>('nudgeRight').addEventListener('click', () => nudgeBy(2, 0));
  q<HTMLButtonElement>('nudgeUp').addEventListener('click', () => nudgeBy(0, -2));
  q<HTMLButtonElement>('nudgeDown').addEventListener('click', () => nudgeBy(0, 2));
  q<HTMLButtonElement>('resetPartTransform').addEventListener('click', () => { partTransforms.set(activePart, { rotationDeg: 0, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 }); renderParts(); });
  q<HTMLButtonElement>('resetAllTransforms').addEventListener('click', () => { for (const part of parts) partTransforms.set(part.name, { rotationDeg: 0, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 }); renderParts(); });

  updateExportButtonState();
  syncIdleReadout(); syncShellModeControls(); renderParts(); scheduleWorkspaceRender(); refreshSaveProjectEnabled(); startPreviewLoop(); selfCheck();
}
