// maggie/intent-router.ts

export type IntentDefinition = {
  pattern: RegExp;
  intent: string;
  extract: (text: string) => Record<string, any>;
};

class IntentParser {
  private defs: IntentDefinition[] = [];

  async add(defs: IntentDefinition[]): Promise<void> {
    this.defs.push(...defs);
  }

  parse(text: string): { intent: string; data: Record<string, any> } | null {
    for (const def of this.defs) {
      if (def.pattern.test(text)) {
        return { intent: def.intent, data: def.extract(text) };
      }
    }
    return null;
  }
}

export const intentParser = new IntentParser();

type Router = {
  onIntent: (intent: string, data: any, ctx: any) => Promise<void> | void;
};

let router: Router | null = null;

export async function addCommandRouter(r: Router): Promise<void> {
  router = r;
}

export async function postLogsTo(...targets: string[]): Promise<void> {
  console.log('[postLogsTo]', targets.join(', '));
  // Optional: implement Discord, Telegram, or DB log posting here
}

export async function dispatch(text: string, ctx: Record<string, any> = {}): Promise<void> {
  const parsed = intentParser.parse(text);
  if (parsed && router) {
    await router.onIntent(parsed.intent, parsed.data, ctx);
  } else {
    console.warn(`[intent-router] No matching intent found for text: "${text}"`);
  }
}