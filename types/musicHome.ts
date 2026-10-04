export type ColorTheme = 'GOLD' | 'BRONZE' | 'COPPER' | 'PLATINUM';
export type BackgroundMode = 'CURATED_LOOP' | 'CUSTOM_UPLOAD' | 'SOLID_OBSIDIAN';
export type MusicHomeModuleType = 'PEARL_HALL' | 'SOVEREIGN_VAULT' | 'SIGNAL_FEED' | 'COLLAB_BRIEFS';

export interface MusicHomeModule {
  id: MusicHomeModuleType;
  type: MusicHomeModuleType;
  order: number;
  isVisible: boolean;
}

export interface MusicHomeConfig {
  schemaVersion: 1;
  creatorId: string;
  theme: ColorTheme;
  backgroundMode: BackgroundMode;
  selectedBackgroundUrl: string;
  unlockedBadges: string[];
  layoutModules: MusicHomeModule[];
  isSovereignModeActive: boolean;
}

export interface MusicHomeMilestones {
  stemUploads: number;
  completedSplits: number;
}

export interface MusicHomeBackground {
  id: string;
  name: string;
  url: string;
  requiredStems: number;
  requiredSplits: number;
}
