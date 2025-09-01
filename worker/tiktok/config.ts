export interface TikTokProfile {
  /** profile key, e.g. main | willow | maggie | mars */
  name: string;
  /** @username on TikTok */
  username: string;
  /** session cookie for the account */
  session: string;
}

/**
 * Read TikTok profile usernames and session cookies from the environment.
 * Expected env keys: TIKTOK_PROFILE_*, TIKTOK_SESSION_* where * is one of
 * MAIN, WILLOW, MAGGIE, MARS. Only pairs with both values present are returned.
 */
export function getProfiles(env: Record<string, string | undefined>): TikTokProfile[] {
  const keys = ["MAIN", "WILLOW", "MAGGIE", "MARS"] as const;
  const profiles: TikTokProfile[] = [];
  for (const key of keys) {
    const username = env[`TIKTOK_PROFILE_${key}`];
    const session = env[`TIKTOK_SESSION_${key}`];
    if (username && session) {
      profiles.push({ name: key.toLowerCase(), username, session });
    }
  }
  return profiles;
}

export function getProfile(env: Record<string, string | undefined>, name: string): TikTokProfile | undefined {
  const profiles = getProfiles(env);
  return profiles.find(p => p.name === name);
}
