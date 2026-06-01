import type { FpvAnimationOffset, FpvFrameOffsets, FpvLayer } from './fpvTypes';

const emptyOffset = (): FpvAnimationOffset => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });

export function buildUnarmedIdleOffsets(layers: FpvLayer[], frameCount: number): FpvFrameOffsets[] {
  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const phase = (frameIndex / frameCount) * Math.PI * 2;
    const breathingBob = Math.sin(phase) * 8;
    const secondaryBob = Math.sin(phase * 2) * 1.5;
    const offsets: FpvFrameOffsets = {};
    for (const layer of layers) {
      const offset = emptyOffset();
      if (layer.kind === 'left-arm') {
        offset.x = Math.sin(phase + 0.35) * 3;
        offset.y = breathingBob + secondaryBob;
        offset.rotation = Math.sin(phase + 0.2) * 1.2;
      } else if (layer.kind === 'right-arm') {
        offset.x = Math.sin(phase + Math.PI - 0.35) * 3;
        offset.y = breathingBob - secondaryBob;
        offset.rotation = Math.sin(phase + Math.PI - 0.2) * 1.2;
      } else if (layer.kind === 'weapon') {
        offset.x = Math.sin(phase + 0.1) * 2;
        offset.y = breathingBob * 0.75;
        offset.rotation = Math.sin(phase + 0.2) * 0.8;
      } else if (layer.kind === 'armor') {
        offset.x = Math.sin(phase) * 2;
        offset.y = breathingBob;
        offset.rotation = Math.sin(phase) * 0.7;
      }
      offsets[layer.id] = {
        x: Number(offset.x.toFixed(3)),
        y: Number(offset.y.toFixed(3)),
        scale: Number(offset.scale.toFixed(4)),
        rotation: Number(offset.rotation.toFixed(3)),
        opacity: Number(offset.opacity.toFixed(4)),
      };
    }
    return offsets;
  });
}
