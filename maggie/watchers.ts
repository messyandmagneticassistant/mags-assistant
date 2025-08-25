export type HeadfulBrowserOptions = {
  mode: string;
  stream?: boolean;
  logScreenshots?: boolean;
  attachDebugger?: boolean;
};

export async function enableHeadfulBrowser(options: HeadfulBrowserOptions): Promise<void> {
  console.log('[enableHeadfulBrowser] starting', options);
}

export type StatusBlock = {
  type: string;
  label: string;
  value?: string;
  dynamic?: boolean;
  action?: string;
};

export type CreateStatusCardOptions = {
  title: string;
  blocks: StatusBlock[];
  destination?: string;
  editable?: boolean;
  notify?: boolean;
};

export async function createStatusCard(options: CreateStatusCardOptions): Promise<void> {
  console.log('[createStatusCard] creating', options);
}

export type StartAgentConsoleOptions = {
  allowManualInput?: boolean;
  allowCancel?: boolean;
  allowQueueInsert?: boolean;
  visibleTo?: string[];
  liveFeed?: boolean;
};

export async function startAgentConsole(options: StartAgentConsoleOptions): Promise<void> {
  console.log('[startAgentConsole] launching', options);
}

export type PostLogUpdateOptions = {
  type: string;
  message: string;
  context?: string[];
};

export async function postLogUpdate(options: PostLogUpdateOptions): Promise<void> {
  console.log('[postLogUpdate] sending', options);
}
