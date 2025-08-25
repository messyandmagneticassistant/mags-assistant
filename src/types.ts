// Represents an active TikTok bot session
export interface BotSession {
  username: string;   // e.g. @messyandmagnetic
  session: string;    // TikTok session cookie
}

// Used when posting updates to PostQ thread
export interface PostThreadParams {
  bot: BotSession;    // Which bot is posting the message
  message: string;    // What the bot is saying
}

// Defines basic structure for a TikTok post (optional future use)
export interface TikTokPost {
  caption: string;
  audioId?: string;
  videoPath: string;
  scheduleTime?: number; // For scheduling posts
  tags?: string[];
  boostAfterUpload?: boolean; // Should booster bots engage?
}

// Structure for tracking task results or errors
export interface AutomationResult {
  success: boolean;
  message?: string;
  error?: any;
}

// Optional config injection for Maggie's workflows
export interface MaggieConfig {
  telegramEnabled?: boolean;
  notionEnabled?: boolean;
  autoFixFlops?: boolean;
  useBrowserless?: boolean;
  schedulePosts?: boolean;
  feedbackMode?: boolean;
}