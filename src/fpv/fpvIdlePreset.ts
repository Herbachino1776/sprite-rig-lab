import { buildFpvOffsets } from './fpvPresets';
import type { FpvFrameOffsets, FpvLayer } from './fpvTypes';

export function buildUnarmedIdleOffsets(layers: FpvLayer[], frameCount: number): FpvFrameOffsets[] {
  return buildFpvOffsets(layers, frameCount, 'unarmed_idle');
}
