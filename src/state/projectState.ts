import type { SpriteAnalysis } from '../image/alphaAnalysis';

export type MaskPart = {
  name: string;
  visible: boolean;
  color: string;
  maskCanvas: HTMLCanvasElement | null;
};

export const defaultPartNames = ['front_arm', 'front_leg', 'rear_leg', 'rear_arm', 'torso', 'head', 'lower_jaw', 'extra_01', 'tail', 'horns'] as const;
export const globularPartNames = ['base', 'torso', 'head', 'lower_jaw', 'front_arm', 'rear_arm', 'extra_01', 'tail'] as const;
export const quadrupedPartNames = ['far_rear_leg', 'far_front_leg', 'torso', 'neck', 'head', 'lower_jaw', 'near_rear_leg', 'near_front_leg', 'tail', 'extra_01', 'horns'] as const;
export type RigTemplate = 'biped' | 'globular' | 'quadruped';

export type JawMode = 'closed' | 'open-hold' | 'talk' | 'pant' | 'bite-snap' | 'snarl-pulse';
export type JawSettings = { openAngle: number; speed: number; blendAmount: number; phaseOffset: number; chatterAmount: number; pantRhythm: number; biteSnapStrength: number };

export type ProjectState = {
  frameCount: 5 | 6;
  cellWidth: number;
  cellHeight: number;
  analysis: SpriteAnalysis | null;
};

export type ProjectSaveData = {
  sourceFileName?: string;
  sourceBaseName?: string;
  exportBaseNameOverride?: string;
  sourceImageDataUrl: string;
  sourceImageWidth: number;
  sourceImageHeight: number;
  sourceBounds: SpriteAnalysis['sourceBounds'];
  floorY: number;
  parts: Array<{ name: string; visible: boolean; color: string; maskDataUrl: string | null }>;
  pivots: Record<string, { x: number; y: number } | undefined>;
  floorContacts: Record<string, { x: number; y: number } | undefined>;
  transforms: Record<string, { rotationDeg: number; translateX: number; translateY: number; scaleX: number; scaleY: number } | undefined>;
  layerOrder: string[];
  exportSettings: {
    frameCount: 5 | 6;
    cellWidth: number;
    cellHeight: number;
    selectedPresetLabel: string;
    recommendedPresetLabel: string;
    recommendedCellWidth: number;
    recommendedCellHeight: number;
    safePaddingXPercent?: number;
    safePaddingYPercent?: number;
  };
  activePart?: string;
  rigTemplate?: RigTemplate;
  animationMode?: 'whole-sprite-idle' | 'part-based-idle' | 'part-based-small-walk' | 'part-based-attack' | 'part-based-globular-crawl' | 'part-based-quadruped-walk';
  idleSettings?: {
    breathingAmount: number;
    headSway: number;
    armDrift: number;
    overallIntensity: number;
  };
  walkSettings?: {
    walkIntensity: number;
    strideWidth: number;
    legCrossing: number;
    hipSway: number;
    armSwing: number;
    footLockStrength: number;
  };
  seamRepairSettings?: {
    enabled: boolean;
    edgeBleedPx: number;
    edgeFeatherPx: number;
    jointOverlapPx: number;
    gapFillEnabled: boolean;
    seamBlendStrength: number;
  };
  attackSettings?: {
    attackStyle?: 'forward-strike' | 'overhead-chop';
    attackIntensity: number;
    attackReach: number;
    torsoLean: number;
    armSwing: number;
    recoilAmount: number;
    chopRaiseAngle?: number;
    chopDownAngle?: number;
    chopArcAmount?: number;
  };
  globularCrawlSettings?: {
    crawlIntensity: number;
    bodySquash: number;
    pullReach: number;
    forwardLurch: number;
    armPull: number;
    trailingDrag: number;
  };
  quadrupedWalkSettings?: {
    stepLength: number;
    legLift: number;
    bodyBob: number;
    headBob: number;
    gaitIntensity: number;
  };
  jawAnimationEnabled?: boolean;
  jawMode?: JawMode;
  jawSettings?: JawSettings;
  jawPivot?: { x: number; y: number };
  lipLine?: { y: number };
};

export const defaultState: ProjectState = { frameCount: 6, cellWidth: 3072, cellHeight: 3072, analysis: null };
