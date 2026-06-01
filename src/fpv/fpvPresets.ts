import type { FpvAnimationId, FpvAnimationOffset, FpvFrameOffsets, FpvLayer, FpvLayerKind } from './fpvTypes';

export type FpvPreset = { id: FpvAnimationId; label: string; fullMotion: boolean };

export const FPV_ANIMATION_CATEGORY = 'FPV';

export const fpvPresets: FpvPreset[] = [
  { id: 'unarmed_idle', label: 'Unarmed Idle', fullMotion: true },
  { id: 'unarmed_ready', label: 'Unarmed Ready', fullMotion: false },
  { id: 'light_attack_placeholder', label: 'Light Attack placeholder', fullMotion: false },
  { id: 'heavy_attack_placeholder', label: 'Heavy Attack placeholder', fullMotion: false },
  { id: 'weapon_idle_placeholder', label: 'Weapon Idle placeholder', fullMotion: false },
];

export const getFpvPreset = (id: FpvAnimationId): FpvPreset => fpvPresets.find((preset) => preset.id === id) ?? fpvPresets[0]!;

const emptyOffset = (): FpvAnimationOffset => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 });

const isHandOrArm = (kind: FpvLayerKind) => kind === 'leftArm' || kind === 'rightArm' || kind === 'leftHand' || kind === 'rightHand' || kind === 'gloveOrArmor' || kind === 'sleeve';

export function buildFpvOffsets(layers: FpvLayer[], frameCount: number, animation: FpvAnimationId): FpvFrameOffsets[] {
  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const phase = (frameIndex / frameCount) * Math.PI * 2;
    const offsets: FpvFrameOffsets = {};
    for (const layer of layers) {
      const offset = emptyOffset();
      if (animation === 'unarmed_idle') {
        const breathingBob = Math.sin(phase) * 8;
        const secondaryBob = Math.sin(phase * 2) * 1.5;
        if (layer.kind === 'leftArm' || layer.kind === 'leftHand') {
          offset.x = Math.sin(phase + 0.35) * 3;
          offset.y = breathingBob + secondaryBob;
          offset.rotation = Math.sin(phase + 0.2) * 1.2;
        } else if (layer.kind === 'rightArm' || layer.kind === 'rightHand') {
          offset.x = Math.sin(phase + Math.PI - 0.35) * 3;
          offset.y = breathingBob - secondaryBob;
          offset.rotation = Math.sin(phase + Math.PI - 0.2) * 1.2;
        } else if (layer.kind === 'weapon') {
          offset.x = Math.sin(phase + 0.1) * 2;
          offset.y = breathingBob * 0.75;
          offset.rotation = Math.sin(phase + 0.2) * 0.8;
        } else if (layer.kind === 'gloveOrArmor' || layer.kind === 'sleeve') {
          offset.x = Math.sin(phase) * 2;
          offset.y = breathingBob;
          offset.rotation = Math.sin(phase) * 0.7;
        } else if (layer.kind === 'extra') {
          offset.y = breathingBob * 0.5;
        }
      } else if (animation === 'unarmed_ready') {
        if (isHandOrArm(layer.kind)) {
          offset.y = -6 + Math.sin(phase) * 2;
          offset.rotation = (layer.kind === 'leftArm' || layer.kind === 'leftHand' ? -1 : 1) * 0.6;
        }
      } else if (animation === 'light_attack_placeholder') {
        const strike = Math.sin(phase) > 0 ? Math.sin(phase) : 0;
        if (isHandOrArm(layer.kind)) {
          offset.y = -10 * strike;
          offset.x = (layer.kind === 'leftArm' || layer.kind === 'leftHand' ? 10 : -10) * strike;
          offset.rotation = (layer.kind === 'leftArm' || layer.kind === 'leftHand' ? -3 : 3) * strike;
        }
      } else if (animation === 'heavy_attack_placeholder') {
        const windup = Math.sin(phase - Math.PI / 3);
        if (isHandOrArm(layer.kind)) {
          offset.y = -12 * windup;
          offset.rotation = (layer.kind === 'leftArm' || layer.kind === 'leftHand' ? -4 : 4) * windup;
        }
      } else if (animation === 'weapon_idle_placeholder') {
        if (layer.kind === 'weapon' || isHandOrArm(layer.kind)) {
          offset.y = Math.sin(phase) * 4;
          offset.rotation = Math.sin(phase + 0.1) * 0.8;
        }
      }
      offsets[layer.id] = {
        x: Number(offset.x.toFixed(3)),
        y: Number(offset.y.toFixed(3)),
        scaleX: Number(offset.scaleX.toFixed(4)),
        scaleY: Number(offset.scaleY.toFixed(4)),
        rotation: Number(offset.rotation.toFixed(3)),
        opacity: Number(offset.opacity.toFixed(4)),
      };
    }
    return offsets;
  });
}
