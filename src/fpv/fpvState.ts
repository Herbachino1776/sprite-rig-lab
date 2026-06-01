import type { FpvLayer, FpvState } from './fpvTypes';

export const FPV_FRAME_COUNT = 6;
export const FPV_CELL_SIZE = 1024;

const transform = (x: number, y: number, rotation: number, visible = true): FpvLayer['baseTransform'] => ({
  x,
  y,
  scaleX: 1,
  scaleY: 1,
  rotation,
  opacity: 1,
  visible,
});

export function createDefaultFpvLayers(): FpvLayer[] {
  return [
    { id: 'sleeve', kind: 'sleeve', label: 'Sleeve', sourceFileName: null, image: null, baseTransform: transform(512, 860, 0, false) },
    { id: 'leftArm', kind: 'leftArm', label: 'Left Arm', sourceFileName: null, image: null, baseTransform: transform(326, 806, -7) },
    { id: 'rightArm', kind: 'rightArm', label: 'Right Arm', sourceFileName: null, image: null, baseTransform: transform(698, 806, 7) },
    { id: 'leftHand', kind: 'leftHand', label: 'Left Hand', sourceFileName: null, image: null, baseTransform: transform(360, 704, -5, false) },
    { id: 'rightHand', kind: 'rightHand', label: 'Right Hand', sourceFileName: null, image: null, baseTransform: transform(664, 704, 5, false) },
    { id: 'weapon', kind: 'weapon', label: 'Weapon', sourceFileName: null, image: null, baseTransform: transform(512, 650, 0, false) },
    { id: 'gloveOrArmor', kind: 'gloveOrArmor', label: 'Glove / Armor', sourceFileName: null, image: null, baseTransform: transform(512, 805, 0, false) },
    { id: 'extra', kind: 'extra', label: 'Extra', sourceFileName: null, image: null, baseTransform: transform(512, 720, 0, false) },
  ];
}

export function createDefaultFpvState(): FpvState {
  return {
    mode: 'fpv-arms',
    animationCategory: 'FPV',
    animation: 'unarmed_idle',
    frameCount: FPV_FRAME_COUNT,
    cellWidth: FPV_CELL_SIZE,
    cellHeight: FPV_CELL_SIZE,
    selectedFrame: 0,
    selectedLayerId: 'leftArm',
    layers: createDefaultFpvLayers(),
  };
}
