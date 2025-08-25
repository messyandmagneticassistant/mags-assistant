export interface BotSession {
  username: string;
  session: string;
}

export interface PostThreadParams {
  bot: BotSession;
  message: string;
}