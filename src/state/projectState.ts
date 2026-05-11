import type { SpriteAnalysis } from '../image/alphaAnalysis';

export type MaskPart = {
  name: string;
  visible: boolean;
  color: string;
  maskCanvas: HTMLCanvasElement | null;
};

export const defaultPartNames = ['front_arm', 'front_leg', 'rear_leg', 'rear_arm', 'torso', 'head', 'extra_01', 'tail', 'horns'] as const;

export type ProjectState = {
  frameCount: 5 | 6;
  cellWidth: number;
  cellHeight: number;
  analysis: SpriteAnalysis | null;
};

export type ProjectSaveData = {
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
  animationMode?: 'whole-sprite-idle' | 'part-based-idle' | 'part-based-small-walk' | 'part-based-attack';
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
};

export const defaultState: ProjectState = { frameCount: 6, cellWidth: 3072, cellHeight: 3072, analysis: null };
