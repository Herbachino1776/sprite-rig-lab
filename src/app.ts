import { analyzeAlpha } from './image/alphaAnalysis';
import { loadPngFromFile } from './image/loadImage';
import { idleTransform } from './motion/idlePreset';
import { downloadBlob } from './export/exporters';
import { detectBleedRisk } from './qa/bleed';
import { defaultState } from './state/projectState';

export function initApp(root: HTMLDivElement) {
  const state = { ...defaultState };
  let image: HTMLImageElement | null = null;

  root.innerHTML = `
    <h1>Sprite Rig Lab</h1>
    <div class="grid">
      <section class="panel">
        <label>Upload transparent PNG sprite</label>
        <input id="file" type="file" accept="image/png" />
        <div class="row">
          <div><label>Frame count</label><select id="frameCount"><option value="5">5</option><option value="6" selected>6</option></select></div>
          <div><label>Cell width</label><input id="cellW" type="number" min="16" value="1024" /></div>
          <div><label>Cell height</label><input id="cellH" type="number" min="16" value="1024" /></div>
        </div>
        <button id="generate">Generate strip</button>
        <button id="png">Export PNG strip</button>
        <button id="json">Export metadata JSON</button>
        <h3>Source analysis</h3>
        <pre id="meta"></pre>
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
  const warnings = root.querySelector<HTMLParagraphElement>('#warnings')!;

  let stripCanvas: HTMLCanvasElement | null = null;

  const renderWorkspace = () => {
    const ctx = workspace.getContext('2d')!;
    ctx.clearRect(0,0,workspace.width,workspace.height);
    if (!image || !state.analysis) return;

    const scale = Math.min(workspace.width / image.width, workspace.height / image.height, 1);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const offsetX = (workspace.width - drawW) / 2;
    const offsetY = (workspace.height - drawH) / 2;
    ctx.drawImage(image, offsetX, offsetY, drawW, drawH);

    const b = state.analysis.sourceBounds;
    ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 2;
    ctx.strokeRect(offsetX + b.x*scale, offsetY + b.y*scale, b.width*scale, b.height*scale);

    const floorY = offsetY + state.analysis.floorY * scale;
    ctx.strokeStyle = '#f4a261';
    ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(workspace.width, floorY); ctx.stroke();
  };

  const generateStrip = () => {
    if (!image || !state.analysis) return;
    const frameCount = state.frameCount;
    const cellWidth = state.cellWidth;
    const cellHeight = state.cellHeight;
    const out = document.createElement('canvas');
    out.width = frameCount * cellWidth;
    out.height = cellHeight;
    const ctx = out.getContext('2d')!;

    const bounds = state.analysis.sourceBounds;
    const baseFloor = cellHeight * 0.85;
    for (let i=0; i<frameCount; i++) {
      const tr = idleTransform(i, frameCount);
      const spriteW = bounds.width * tr.scale;
      const spriteH = bounds.height * tr.scale;
      const centerX = i * cellWidth + cellWidth / 2;
      const x = centerX - spriteW / 2 - bounds.x * tr.scale;
      const y = baseFloor - spriteH - bounds.y * tr.scale + tr.bobY;
      ctx.drawImage(image, x, y, image.width * tr.scale, image.height * tr.scale);
    }
    stripCanvas = out;
    renderPreview();
  };

  const renderPreview = () => {
    if (!stripCanvas) return;
    const ctx = preview.getContext('2d')!;
    let frame = 0;
    const tick = () => {
      if (!stripCanvas) return;
      const fw = state.cellWidth;
      const fh = state.cellHeight;
      ctx.clearRect(0,0,preview.width,preview.height);
      ctx.drawImage(stripCanvas, frame*fw, 0, fw, fh, 0, 0, preview.width, preview.height);
      frame = (frame + 1) % state.frameCount;
      requestAnimationFrame(() => setTimeout(tick, 160));
    };
    tick();
  };

  root.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    image = await loadPngFromFile(file);
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
    c.getContext('2d')!.drawImage(image,0,0);
    state.analysis = analyzeAlpha(c.getContext('2d')!.getImageData(0,0,c.width,c.height));
    meta.textContent = JSON.stringify(state.analysis, null, 2);
    warnings.textContent = state.analysis.warnings.join(' | ');
    renderWorkspace();
  });

  root.querySelector<HTMLSelectElement>('#frameCount')!.addEventListener('change', (e) => state.frameCount = Number((e.target as HTMLSelectElement).value) as 5|6);
  root.querySelector<HTMLInputElement>('#cellW')!.addEventListener('input', (e) => state.cellWidth = Number((e.target as HTMLInputElement).value));
  root.querySelector<HTMLInputElement>('#cellH')!.addEventListener('input', (e) => state.cellHeight = Number((e.target as HTMLInputElement).value));

  root.querySelector<HTMLButtonElement>('#generate')!.addEventListener('click', generateStrip);
  root.querySelector<HTMLButtonElement>('#png')!.addEventListener('click', async () => {
    if (!stripCanvas) return;
    const blob = await new Promise<Blob>((resolve) => stripCanvas!.toBlob((b) => resolve(b!), 'image/png'));
    downloadBlob('sprite-strip.png', blob);
  });

  root.querySelector<HTMLButtonElement>('#json')!.addEventListener('click', () => {
    if (!state.analysis) return;
    const metadata = {
      frameCount: state.frameCount,
      cellWidth: state.cellWidth,
      cellHeight: state.cellHeight,
      stripWidth: state.frameCount * state.cellWidth,
      stripHeight: state.cellHeight,
      floorY: Math.round(state.cellHeight * 0.85),
      alphaVerified: state.analysis.alphaVerified,
      sourceBounds: state.analysis.sourceBounds,
      bleedRisk: detectBleedRisk(state.analysis.sourceBounds.width, state.analysis.sourceBounds.height, state.cellWidth, state.cellHeight)
    };
    downloadBlob('sprite-strip.json', new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }));
  });
}
