import type { SpriteAnalysis } from '../image/alphaAnalysis';

export type MaskPart = {
  name: string;
  visible: boolean;
  color: string;
  maskCanvas: HTMLCanvasElement | null;
};

export const defaultPartNames = ['torso', 'head', 'front_arm', 'rear_arm', 'front_leg', 'rear_leg', 'horns', 'tail', 'extra_01'] as const;

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
  layerOrder: string[];
  exportSettings: {
    frameCount: 5 | 6;
    cellWidth: number;
    cellHeight: number;
    selectedPresetLabel: string;
    recommendedPresetLabel: string;
    recommendedCellWidth: number;
    recommendedCellHeight: number;
  };
};

export const defaultState: ProjectState = { frameCount: 6, cellWidth: 1024, cellHeight: 1024, analysis: null };
