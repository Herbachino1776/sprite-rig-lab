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
  image: HTMLImageElement | null;
  baseTransform: FpvTransform;
};

export type FpvAnimationId = 'unarmed_idle' | 'unarmed_ready' | 'light_attack_placeholder' | 'heavy_attack_placeholder' | 'weapon_idle_placeholder';

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
  layers: Array<{
    id: string;
    kind: FpvLayerKind;
    label: string;
    sourceFileName: string | null;
    layerOrder: number;
    baseTransform: FpvTransform;
  }>;
  perFrameAnimationOffsets: FpvFrameOffsets[];
  qa: FpvQaReport;
};
