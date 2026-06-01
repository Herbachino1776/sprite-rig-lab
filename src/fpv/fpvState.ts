import type { FpvLayer, FpvState } from './fpvTypes';

export const FPV_FRAME_COUNT = 6;
export const FPV_CELL_SIZE = 1024;

const transform = (x: number, y: number, rotation: number): FpvLayer['baseTransform'] => ({
  x,
  y,
  scale: 1,
  rotation,
  opacity: 1,
  visible: true,
});

export function createDefaultFpvLayers(): FpvLayer[] {
  return [
    { id: 'left-arm', kind: 'left-arm', label: 'Left hand / arm', sourceFileName: null, image: null, baseTransform: transform(326, 806, -7) },
    { id: 'right-arm', kind: 'right-arm', label: 'Right hand / arm', sourceFileName: null, image: null, baseTransform: transform(698, 806, 7) },
    { id: 'weapon', kind: 'weapon', label: 'Weapon (optional)', sourceFileName: null, image: null, baseTransform: { ...transform(512, 650, 0), visible: false } },
    { id: 'armor', kind: 'armor', label: 'Armor / glove (optional)', sourceFileName: null, image: null, baseTransform: { ...transform(512, 805, 0), visible: false } },
  ];
}

export function createDefaultFpvState(): FpvState {
  return {
    mode: 'fpv-arms',
    animation: 'unarmed_idle',
    frameCount: FPV_FRAME_COUNT,
    cellWidth: FPV_CELL_SIZE,
    cellHeight: FPV_CELL_SIZE,
    selectedFrame: 0,
    selectedLayerId: 'left-arm',
    layers: createDefaultFpvLayers(),
  };
}
