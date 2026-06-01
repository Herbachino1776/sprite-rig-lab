import { buildUnarmedIdleOffsets } from './fpvIdlePreset';
import type { FpvFrameOffsets, FpvRenderResult, FpvState } from './fpvTypes';

function getOffsets(state: FpvState): FpvFrameOffsets[] {
  if (state.animation === 'unarmed_idle') return buildUnarmedIdleOffsets(state.layers, state.frameCount);
  return buildUnarmedIdleOffsets(state.layers, state.frameCount);
}

export function renderFpvFrame(ctx: CanvasRenderingContext2D, state: FpvState, frameIndex: number, targetWidth = state.cellWidth, targetHeight = state.cellHeight): FpvFrameOffsets {
  const offsets = getOffsets(state);
  const frameOffsets = offsets[frameIndex] ?? offsets[0] ?? {};
  const scaleX = targetWidth / state.cellWidth;
  const scaleY = targetHeight / state.cellHeight;
  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.save();
  ctx.scale(scaleX, scaleY);
  for (const layer of state.layers) {
    if (!layer.image || !layer.baseTransform.visible) continue;
    const offset = frameOffsets[layer.id] ?? { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
    const base = layer.baseTransform;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, base.opacity * offset.opacity));
    ctx.translate(base.x + offset.x, base.y + offset.y);
    ctx.rotate(((base.rotation + offset.rotation) * Math.PI) / 180);
    const combinedScale = base.scale * offset.scale;
    ctx.scale(combinedScale, combinedScale);
    ctx.drawImage(layer.image, -layer.image.width / 2, -layer.image.height / 2);
    ctx.restore();
  }
  ctx.restore();
  return frameOffsets;
}

export function renderFpvStrip(state: FpvState): FpvRenderResult {
  const canvas = document.createElement('canvas');
  canvas.width = state.cellWidth * state.frameCount;
  canvas.height = state.cellHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const frame = document.createElement('canvas');
  frame.width = state.cellWidth;
  frame.height = state.cellHeight;
  const frameCtx = frame.getContext('2d', { willReadFrequently: true })!;
  const frameOffsets = getOffsets(state);
  for (let i = 0; i < state.frameCount; i += 1) {
    renderFpvFrame(frameCtx, state, i);
    ctx.drawImage(frame, i * state.cellWidth, 0);
  }
  return { canvas, frameOffsets };
}
