// maggie/intent-router.ts

type IntentPattern = {
  pattern: RegExp;
  intent: string;
  extract: (text: string) => Record<string, string>;
};

let registeredPatterns: IntentPattern[] = [];

/**
 * Add command patterns to Maggie's intent parser.
 */
export const intentParser = {
  add: async (patterns: IntentPattern[]) => {
    registeredPatterns.push(...patterns);
    console.log(
      `🧠 intentParser registered ${patterns.length} new pattern(s):`,
      patterns.map((p) => p.intent)
    );
  },

  /**
   * Try to parse a given input string and return the matched intent.
   */
  parse: (text: string) => {
    for (const pattern of registeredPatterns) {
      if (pattern.pattern.test(text)) {
        return {
          intent: pattern.intent,
          args: pattern.extract(text),
        };
      }
    }
    return null;
  },
};

/**
 * Placeholder dispatcher to show where matched intent would route.
 * You can wire this up to actual handlers later.
 */
export async function dispatch(input: string) {
  const parsed = intentParser.parse(input);
  if (!parsed) {
    console.warn(`⚠️ No intent matched: "${input}"`);
    return;
  }

  console.log(`✅ Intent matched: ${parsed.intent}`);
  console.log(`📦 Args:`, parsed.args);

  // 🔜 Add real dispatch logic here if needed
  // Example:
  // if (parsed.intent === 'setCaption') {
  //   return await setCaption(parsed.args.caption);
  // }
}