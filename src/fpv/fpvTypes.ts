export type FpvLayerKind = 'leftArm' | 'rightArm' | 'leftHand' | 'rightHand' | 'weapon' | 'gloveOrArmor' | 'sleeve' | 'extra';

export type FpvTransform = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  visible: boolean;
};

export type FpvAnimationOffset = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
};

export type FpvLayer = {
  id: string;
  kind: FpvLayerKind;
  label: string;
  sourceFileName: string | null;
  imageDataUrl: string | null;
  image: HTMLImageElement | null;
  baseTransform: FpvTransform;
};

export type FpvAnimationId = 'unarmed_idle' | 'unarmed_ready' | 'punch_claw' | 'weapon_idle_placeholder' | 'light_attack_placeholder' | 'heavy_attack_placeholder';

export type FpvIdleSettings = {
  bobAmount: number;
  bobSpeed: number;
  handDriftX: number;
  handDriftY: number;
  rotationSway: number;
  asymmetry: number;
  phaseOffset: number;
};

export type FpvPunchClawSettings = {
  reach: number;
  recoil: number;
  verticalSwing: number;
  arc: number;
  rotation: number;
  anticipation: number;
  speed: number;
  leftRightOffset: number;
  impactSnap: number;
};

export type FpvAnimationSettings = {
  idle: FpvIdleSettings;
  punchClaw: FpvPunchClawSettings;
};

export type FpvFrameOffsets = Record<string, FpvAnimationOffset>;

export type FpvState = {
  mode: 'fpv-arms';
  animationCategory: 'FPV';
  animation: FpvAnimationId;
  frameCount: number;
  cellWidth: number;
  cellHeight: number;
  selectedFrame: number;
  selectedLayerId: string;
  previewPlaying: boolean;
  previewFps: number;
  animationSettings: FpvAnimationSettings;
  layers: FpvLayer[];
};

export type FpvRenderResult = {
  canvas: HTMLCanvasElement;
  frameOffsets: FpvFrameOffsets[];
};

export type FpvQaReport = {
  alphaVerified: boolean;
  hasTransparentPixels: boolean;
  allPixelsOpaque: boolean;
  cornersOpaque: boolean;
  likelyBakedBackground: boolean;
  likelyCheckerboardBackground: boolean;
  likelySolidWhiteBackground: boolean;
  likelySolidBlackBackground: boolean;
  dimensionsMatch: boolean;
  metadataMatches: boolean;
  cellBleedRisk: boolean;
  warnings: string[];
};

export type FpvMetadata = {
  mode: 'fpv-arms';
  animationCategory: 'FPV';
  animation: FpvAnimationId;
  animationLabel: string;
  frameCount: number;
  cellWidth: number;
  cellHeight: number;
  stripWidth: number;
  stripHeight: number;
  alphaVerified: boolean;
  bleedRisk: boolean;
  animationSettings: FpvAnimationSettings;
  previewSettings: { selectedFrame: number; previewPlaying: boolean; previewFps: number };
  layers: Array<{
    id: string;
    kind: FpvLayerKind;
    label: string;
    sourceFileName: string | null;
    layerOrder: number;
    visible: boolean;
    opacity: number;
    baseTransform: FpvTransform;
  }>;
  perFrameAnimationOffsets: FpvFrameOffsets[];
  qa: FpvQaReport;
};
