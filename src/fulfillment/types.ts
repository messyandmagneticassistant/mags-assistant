import type { drive_v3, docs_v1 } from 'googleapis';

export type FulfillmentTier = 'mini' | 'lite' | 'full';

export interface BirthData {
  date?: string;
  time?: string;
  location?: string;
  timezone?: string;
}

export interface CustomerProfile {
  name?: string;
  firstName?: string;
  lastName?: string;
  pronouns?: string;
  birth?: BirthData;
  partnerName?: string;
  householdMembers?: string[];
}

export interface NormalizedIntake {
  source: 'stripe' | 'tally';
  email: string;
  tier: FulfillmentTier;
  addOns: string[];
  prefs: Record<string, any>;
  customer: CustomerProfile;
  /**
   * Optional list of expansions to enable for this fulfillment run (e.g. advanced esoteric suite).
   */
  expansions?: string[];
  /**
   * Derived cohort from intake data so downstream modules can simplify language for younger clients.
   */
  ageCohort?: 'child' | 'teen' | 'adult' | 'elder';
  referenceId?: string;
  schedulePreferences?: string[];
  raw?: any;
}

export interface ModelAttempt {
  provider: 'codex' | 'claude' | 'gemini';
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  error?: string;
}

export interface BlueprintResult {
  docId: string;
  docUrl: string;
  pdfId: string;
  pdfUrl: string;
  summary: string;
  story: string;
  attempts: ModelAttempt[];
  folderId: string;
  folderUrl: string;
}

export interface IconAsset {
  slug: string;
  name: string;
  description: string;
  url: string;
  fileId: string;
  origin: 'library' | 'generated' | 'blank';
  isBlank?: boolean;
}

export interface IconBundleResult {
  bundleFolderId: string;
  bundleFolderUrl: string;
  manifestId: string;
  manifestUrl: string;
  bundleId?: string;
  bundleName?: string;
  bundleCategory?: string;
  bundleSource?: 'stored' | 'generated' | 'fallback';
  helperBots?: { name: string; instructions: string; payload?: Record<string, any> }[];
  keywords?: string[];
  icons: IconAsset[];
}

export interface ScheduleFile {
  type: 'daily' | 'weekly' | 'monthly';
  docId: string;
  docUrl: string;
  pdfId: string;
  pdfUrl: string;
  headline: string;
}

export interface ScheduleResult {
  scheduleFolderId: string;
  scheduleFolderUrl: string;
  files: ScheduleFile[];
}

export interface DeliveryReceipt {
  channel: 'email' | 'zoho';
  id?: string;
}

export interface FulfillmentWorkspace {
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
  rootFolderId: string;
  orderFolderId: string;
  orderFolderUrl: string;
  timestamp: Date;
  config: FulfillmentConfig;
}

export interface FulfillmentConfig {
  driveRootId: string;
  blueprintTemplateId?: string;
  scheduleTemplates?: {
    daily?: string;
    weekly?: string;
    monthly?: string;
  };
  intakeFallbackFormUrl?: string;
  sheetId?: string;
  notionDatabaseId?: string;
  telegramChatId?: string;
  telegramBotToken?: string;
  iconLibraryFolderId?: string;
  resendFromEmail?: string;
  resendFromName?: string;
  bundleLibrarySheetId?: string;
}

export interface FulfillmentRecord {
  intake: NormalizedIntake;
  blueprint: BlueprintResult;
  icons: IconBundleResult;
  schedule: ScheduleResult;
  delivery: DeliveryReceipt[];
  workspace: FulfillmentWorkspace;
}

export interface OrderSummary {
  email: string;
  tier: FulfillmentTier;
  status: 'success' | 'error';
  message: string;
  completedAt: string;
  files: string[];
}
