import { defaultFpvAnimationSettings, mergeFpvAnimationSettings } from './fpvState';
import type { FpvAnimationId, FpvAnimationOffset, FpvAnimationSettings, FpvFrameOffsets, FpvLayer, FpvLayerKind } from './fpvTypes';

export type FpvPreset = { id: FpvAnimationId; label: string; fullMotion: boolean; description: string };

export const FPV_ANIMATION_CATEGORY = 'FPV';

export const fpvPresets: FpvPreset[] = [
  { id: 'unarmed_idle', label: 'Idle', fullMotion: true, description: 'Looping first-person breathing, bob, drift, and hand sway.' },
  { id: 'unarmed_ready', label: 'Ready', fullMotion: false, description: 'Minimal ready hold placeholder with subtle lift.' },
  { id: 'punch_claw', label: 'Punch / Claw', fullMotion: true, description: 'Short lower-viewport strike with anticipation, reach, snap, and recoil.' },
  { id: 'weapon_idle_placeholder', label: 'Weapon Idle placeholder', fullMotion: false, description: 'Reserved for weapon-ready FPV motion.' },
  { id: 'light_attack_placeholder', label: 'Light Attack placeholder', fullMotion: false, description: 'Reserved for quick weapon attacks.' },
  { id: 'heavy_attack_placeholder', label: 'Heavy Attack placeholder', fullMotion: false, description: 'Reserved for heavier weapon attacks.' },
];

export const getFpvPreset = (id: FpvAnimationId): FpvPreset => fpvPresets.find((preset) => preset.id === id) ?? fpvPresets[0]!;

const emptyOffset = (): FpvAnimationOffset => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 });

const isLeft = (kind: FpvLayerKind) => kind === 'leftArm' || kind === 'leftHand';
const isRight = (kind: FpvLayerKind) => kind === 'rightArm' || kind === 'rightHand';
const isHandOrArm = (kind: FpvLayerKind) => isLeft(kind) || isRight(kind) || kind === 'gloveOrArmor' || kind === 'sleeve';
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp01(value), 3);
const easeInOut = (value: number) => 0.5 - Math.cos(clamp01(value) * Math.PI) * 0.5;

function attackProgress(frameIndex: number, frameCount: number, speed: number) {
  const raw = frameCount <= 1 ? 0 : frameIndex / (frameCount - 1);
  const t = clamp01(raw * Math.max(0.25, speed));
  const anticipationEnd = 0.24;
  const strikeEnd = 0.58;
  const anticipation = t < anticipationEnd ? easeInOut(t / anticipationEnd) : 0;
  const strike = t >= anticipationEnd && t < strikeEnd ? easeOutCubic((t - anticipationEnd) / (strikeEnd - anticipationEnd)) : t >= strikeEnd ? 1 : 0;
  const recoil = t >= strikeEnd ? easeInOut((t - strikeEnd) / Math.max(0.01, 1 - strikeEnd)) : 0;
  return { t, anticipation, strike, recoil, impact: t >= 0.46 && t <= 0.62 ? 1 : 0 };
}

export function buildFpvOffsets(layers: FpvLayer[], frameCount: number, animation: FpvAnimationId, animationSettings?: Partial<FpvAnimationSettings>): FpvFrameOffsets[] {
  const settings = mergeFpvAnimationSettings(animationSettings ?? defaultFpvAnimationSettings);
  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const idle = settings.idle;
    const phase = ((frameIndex / frameCount) * Math.PI * 2 * idle.bobSpeed) + idle.phaseOffset;
    const offsets: FpvFrameOffsets = {};
    for (const layer of layers) {
      const offset = emptyOffset();
      if (animation === 'unarmed_idle') {
        const breathingBob = Math.sin(phase) * idle.bobAmount;
        const secondaryBob = Math.sin(phase * 2) * idle.handDriftY;
        const asymmetricPhase = idle.asymmetry;
        if (isLeft(layer.kind)) {
          offset.x = Math.sin(phase + asymmetricPhase) * idle.handDriftX;
          offset.y = breathingBob + secondaryBob;
          offset.rotation = Math.sin(phase + 0.2 + asymmetricPhase * 0.4) * idle.rotationSway;
        } else if (isRight(layer.kind)) {
          offset.x = Math.sin(phase + Math.PI - asymmetricPhase) * idle.handDriftX;
          offset.y = breathingBob - secondaryBob;
          offset.rotation = Math.sin(phase + Math.PI - 0.2 - asymmetricPhase * 0.4) * idle.rotationSway;
        } else if (layer.kind === 'weapon') {
          offset.x = Math.sin(phase + 0.1) * idle.handDriftX * 0.7;
          offset.y = breathingBob * 0.75;
          offset.rotation = Math.sin(phase + 0.2) * idle.rotationSway * 0.7;
        } else if (layer.kind === 'gloveOrArmor' || layer.kind === 'sleeve') {
          offset.x = Math.sin(phase) * idle.handDriftX * 0.65;
          offset.y = breathingBob;
          offset.rotation = Math.sin(phase) * idle.rotationSway * 0.55;
        } else if (layer.kind === 'extra') {
          offset.y = breathingBob * 0.5;
        }
      } else if (animation === 'punch_claw') {
        const attack = settings.punchClaw;
        const p = attackProgress(frameIndex, frameCount, attack.speed);
        const snapBoost = p.impact * attack.impactSnap;
        const strikeAmount = p.strike * (1 + snapBoost * 0.18);
        const recoilAmount = p.recoil;
        if (isLeft(layer.kind) || isRight(layer.kind)) {
          const side = isLeft(layer.kind) ? -1 : 1;
          const lead = isRight(layer.kind) ? 1 : 0.62;
          const outward = side * (attack.leftRightOffset * strikeAmount - attack.arc * p.anticipation + attack.arc * 0.55 * recoilAmount);
          offset.x = (outward + side * attack.arc * Math.sin(p.t * Math.PI) - side * attack.leftRightOffset * 0.24 * recoilAmount) * lead;
          offset.y = (-attack.reach * strikeAmount + attack.anticipation * p.anticipation + attack.recoil * recoilAmount) * lead - Math.sin(p.t * Math.PI) * attack.verticalSwing;
          offset.rotation = side * (-attack.rotation * p.anticipation + attack.rotation * 1.35 * strikeAmount - attack.rotation * 0.75 * recoilAmount) * lead;
          offset.scaleX = 1 + strikeAmount * 0.06 * lead - recoilAmount * 0.025;
          offset.scaleY = 1 + strikeAmount * 0.09 * lead - recoilAmount * 0.03;
        } else if (layer.kind === 'weapon') {
          offset.x = attack.arc * 0.2 * Math.sin(p.t * Math.PI);
          offset.y = -attack.reach * 0.55 * strikeAmount + attack.recoil * 0.35 * recoilAmount;
          offset.rotation = attack.rotation * 0.8 * strikeAmount - attack.rotation * 0.45 * recoilAmount;
        } else if (layer.kind === 'gloveOrArmor' || layer.kind === 'sleeve') {
          offset.y = -attack.reach * 0.72 * strikeAmount + attack.recoil * 0.45 * recoilAmount;
          offset.rotation = attack.rotation * 0.35 * strikeAmount;
        }
      } else if (animation === 'unarmed_ready') {
        if (isHandOrArm(layer.kind)) {
          offset.y = -6 + Math.sin(phase) * 2;
          offset.rotation = (isLeft(layer.kind) ? -1 : 1) * 0.6;
        }
      } else if (animation === 'light_attack_placeholder') {
        const strike = Math.sin(phase) > 0 ? Math.sin(phase) : 0;
        if (isHandOrArm(layer.kind)) {
          offset.y = -10 * strike;
          offset.x = (isLeft(layer.kind) ? 10 : -10) * strike;
          offset.rotation = (isLeft(layer.kind) ? -3 : 3) * strike;
        }
      } else if (animation === 'heavy_attack_placeholder') {
        const windup = Math.sin(phase - Math.PI / 3);
        if (isHandOrArm(layer.kind)) {
          offset.y = -12 * windup;
          offset.rotation = (isLeft(layer.kind) ? -4 : 4) * windup;
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
