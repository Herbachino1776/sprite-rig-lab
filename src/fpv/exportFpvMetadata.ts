import type { FpvMetadata, FpvQaReport, FpvState, FpvFrameOffsets } from './fpvTypes';

export function exportFpvMetadata(state: FpvState, frameOffsets: FpvFrameOffsets[], qa: FpvQaReport): FpvMetadata {
  const stripWidth = state.cellWidth * state.frameCount;
  const stripHeight = state.cellHeight;
  return {
    mode: 'fpv-arms',
    animation: state.animation,
    frameCount: state.frameCount,
    cellWidth: state.cellWidth,
    cellHeight: state.cellHeight,
    stripWidth,
    stripHeight,
    alphaVerified: qa.alphaVerified,
    bleedRisk: qa.cellBleedRisk,
    layers: state.layers.map((layer) => ({
      id: layer.id,
      kind: layer.kind,
      label: layer.label,
      sourceFileName: layer.sourceFileName,
      baseTransform: { ...layer.baseTransform },
    })),
    perFrameAnimationOffsets: frameOffsets,
    qa,
  };
}
