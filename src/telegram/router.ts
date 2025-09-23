import { COMMANDS, type TelegramCommandContext } from './commands';

const COMMAND_LOOKUP = new Map(COMMANDS.map((cmd) => [cmd.command, cmd]));
const STATUS_RATE_LIMIT_MS = 5000;
const statusRate = new Map<string, number>();

const ALIASES: Record<string, string> = {
  '/help': '/maggie-help',
  '/status': '/maggie-status',
};

function normalize(text: string): string {
  const base = text.trim().split(/\s+/)[0].toLowerCase();
  return ALIASES[base] || base;
}

export async function routeTelegramCommand(ctx: TelegramCommandContext): Promise<boolean> {
  const base = normalize(ctx.text);
  const command = COMMAND_LOOKUP.get(base);
  if (!command) return false;

  if (command.command === '/maggie-status' && ctx.chatId) {
    const now = Date.now();
    const last = statusRate.get(ctx.chatId) ?? 0;
    if (now - last < STATUS_RATE_LIMIT_MS) {
      const waitMs = STATUS_RATE_LIMIT_MS - (now - last);
      const seconds = Math.ceil(waitMs / 1000);
      await ctx.reply(`⏱️ Please wait ${seconds}s before requesting status again.`);
      return true;
    }
    statusRate.set(ctx.chatId, now);
  }

  await command.handler(ctx);
  return true;
}

export function listTelegramCommands() {
  return COMMANDS;
}
