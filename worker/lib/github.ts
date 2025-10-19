import type { Env } from './env';

type AnyEnv = Env & Record<string, unknown>;

export type GitHubRepo = { owner: string; repo: string };

export type GitHubRequestResult<T = unknown> = {
  ok: boolean;
  status: number;
  data?: T | null;
  error?: string;
  source?: 'pat' | 'app';
  skipped?: boolean;
};

type GitHubAuthInfo = {
  token: string;
  source: 'pat' | 'app';
  expiresAt?: number | null;
  cacheKey: string;
};

const PAT_TOKEN_KEYS = ['GH_PAT', 'GITHUB_PAT', 'GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_APP_TOKEN'];

const APP_ID_KEYS = ['GITHUB_APP_ID', 'GH_APP_ID'];
const INSTALLATION_ID_KEYS = ['GITHUB_APP_INSTALLATION_ID', 'GITHUB_INSTALLATION_ID', 'GH_INSTALLATION_ID'];
const PRIVATE_KEY_KEYS = [
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_PEM',
  'GITHUB_PRIVATE_KEY',
  'GITHUB_APP_PRIVATE_KEY_BASE64',
  'GITHUB_APP_PK',
];

let cachedAuth: GitHubAuthInfo | null = null;

function firstNonEmptyString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function fingerprint(value: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(-12);
}

function findPatToken(env: AnyEnv): string | null {
  for (const key of PAT_TOKEN_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function isCachedAuthValid(auth: GitHubAuthInfo | null, cacheKey: string): auth is GitHubAuthInfo {
  if (!auth) return false;
  if (auth.cacheKey !== cacheKey) return false;
  if (!auth.expiresAt) return true;
  return Date.now() < auth.expiresAt - 60_000; // refresh 60s before expiry
}

function normalizePem(input: string): string {
  return input.replace(/\\n/g, '\n').trim();
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = normalizePem(pem);
  const base64 = normalized
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlEncode(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += 1) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createGitHubAppJwt(appId: string, privateKey: string): Promise<string | null> {
  try {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60,
      exp: now + 8 * 60,
      iss: appId,
    };

    const encoder = new TextEncoder();
    const headerEncoded = base64UrlEncode(encoder.encode(JSON.stringify(header)));
    const payloadEncoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
    const signingInput = `${headerEncoded}.${payloadEncoded}`;

    const keyData = pemToArrayBuffer(privateKey);
    const key = await crypto.subtle.importKey(
      'pkcs8',
      keyData,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
    const signatureEncoded = base64UrlEncode(new Uint8Array(signatureBuffer));
    return `${signingInput}.${signatureEncoded}`;
  } catch (err) {
    console.warn('[github] Failed to generate app JWT', err);
    return null;
  }
}

async function fetchInstallationToken(env: AnyEnv, appId: string, installationId: string, privateKey: string): Promise<GitHubAuthInfo | null> {
  const jwt = await createGitHubAppJwt(appId, privateKey);
  if (!jwt) return null;

  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'maggie-worker',
      },
    });

    const text = await response.text();
    let data: { token?: string; expires_at?: string; message?: string } | null = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text } as any;
      }
    }

    if (!response.ok) {
      console.warn('[github] Installation token request failed', response.status, data);
      return null;
    }

    const token = data?.token;
    if (!token) {
      console.warn('[github] Installation token missing in response');
      return null;
    }

    const expiresAt = data?.expires_at ? new Date(data.expires_at).getTime() : null;
    return {
      token,
      source: 'app',
      expiresAt,
      cacheKey: `app:${appId}:${installationId}:${fingerprint(privateKey)}`,
    } satisfies GitHubAuthInfo;
  } catch (err) {
    console.error('[github] Failed to obtain installation token', err);
    return null;
  }
}

async function resolveGitHubAuth(env: AnyEnv): Promise<GitHubAuthInfo | null> {
  const pat = findPatToken(env);
  if (pat) {
    const cacheKey = `pat:${fingerprint(pat)}`;
    if (isCachedAuthValid(cachedAuth, cacheKey)) {
      return cachedAuth;
    }
    cachedAuth = { token: pat, source: 'pat', cacheKey };
    return cachedAuth;
  }

  const appId = APP_ID_KEYS.map((key) => (typeof env[key] === 'string' ? String(env[key]) : null)).find((value) => value && value.trim());
  const installationId = INSTALLATION_ID_KEYS.map((key) => (typeof env[key] === 'string' ? String(env[key]) : null)).find((value) => value && value.trim());
  const privateKeyCandidate = PRIVATE_KEY_KEYS.map((key) => (typeof env[key] === 'string' ? String(env[key]) : null)).find((value) => value && value.trim());

  if (!appId || !installationId || !privateKeyCandidate) {
    return null;
  }

  const cacheKey = `app:${fingerprint(appId)}:${fingerprint(installationId)}:${fingerprint(privateKeyCandidate)}`;
  if (isCachedAuthValid(cachedAuth, cacheKey)) {
    return cachedAuth;
  }

  const token = await fetchInstallationToken(env, appId.trim(), installationId.trim(), privateKeyCandidate.trim());
  if (!token) {
    return null;
  }

  cachedAuth = token;
  cachedAuth.cacheKey = cacheKey;
  return cachedAuth;
}

export async function getGitHubToken(env: AnyEnv): Promise<GitHubAuthInfo | null> {
  const auth = await resolveGitHubAuth(env);
  if (!auth) {
    console.warn('[github] No GitHub token available (PAT or App credentials missing)');
  }
  return auth;
}

export function parseRepo(fullName?: string | null): GitHubRepo | null {
  if (!fullName || typeof fullName !== 'string') return null;
  const parts = fullName.split('/').map((segment) => segment.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

function resolveRepoFromEnv(env: AnyEnv, override?: string | null): GitHubRepo | null {
  const candidate = firstNonEmptyString(override ?? null, env.GITHUB_REPOSITORY as string | undefined, env.GITHUB_DEPLOYMENT_LOG_REPO as string | undefined);
  return parseRepo(candidate ?? null);
}

export async function githubRequest<T = unknown>(
  env: AnyEnv,
  path: string,
  init?: RequestInit & { parseJson?: boolean }
): Promise<GitHubRequestResult<T>> {
  const auth = await getGitHubToken(env);
  if (!auth) {
    return { ok: false, status: 401, error: 'github-token-missing', skipped: true };
  }

  const headers = new Headers(init?.headers);
  if (!headers.has('authorization')) headers.set('authorization', `Bearer ${auth.token}`);
  if (!headers.has('accept')) headers.set('accept', 'application/vnd.github+json');
  if (!headers.has('user-agent')) headers.set('user-agent', 'maggie-worker');
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(`https://api.github.com${path}`, { ...init, headers });
  const text = await response.text();

  let data: any = null;
  if (text) {
    if (init?.parseJson === false) {
      data = text as unknown as T;
    } else {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }
    }
  }

  if (!response.ok) {
    const error = typeof data === 'string' ? data : (data?.message as string | undefined) || 'github-request-failed';
    return { ok: false, status: response.status, data, error, source: auth.source };
  }

  return { ok: true, status: response.status, data, source: auth.source };
}

export async function createIssueComment(env: AnyEnv, repo: GitHubRepo, issueNumber: number, body: string): Promise<GitHubRequestResult> {
  return githubRequest(env, `/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export async function createDiscussionComment(
  env: AnyEnv,
  repo: GitHubRepo,
  discussionNumber: number,
  body: string
): Promise<GitHubRequestResult> {
  return githubRequest(env, `/repos/${repo.owner}/${repo.repo}/discussions/${discussionNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export async function closeIssue(
  env: AnyEnv,
  repo: GitHubRepo,
  issueNumber: number,
  options?: { reason?: 'completed' | 'not_planned' | 'reopened'; allowStateReason?: boolean }
): Promise<GitHubRequestResult> {
  const payload: Record<string, unknown> = { state: 'closed' };
  if (options?.reason && options.allowStateReason) {
    payload.state_reason = options.reason;
  }
  return githubRequest(env, `/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function logDeploymentToGitHub(
  env: AnyEnv,
  details: { message: string; host: string; commit: string; timestamp: string }
): Promise<GitHubRequestResult> {
  const repo = resolveRepoFromEnv(env, (env as AnyEnv).GITHUB_DEPLOYMENT_LOG_REPO as string | undefined);
  const issueNumberRaw = (env as AnyEnv).GITHUB_DEPLOYMENT_LOG_ISSUE;
  const issueNumber = typeof issueNumberRaw === 'string' ? Number.parseInt(issueNumberRaw, 10) : Number(issueNumberRaw);

  if (!repo || !Number.isFinite(issueNumber) || issueNumber <= 0) {
    return { ok: false, status: 400, error: 'deployment-log-target-missing', skipped: true };
  }

  const header = '🚀 **Maggie deployment recorded**';
  const commentBody = [
    header,
    '',
    details.message.trim(),
    '',
    `Commit: \`${details.commit}\``,
    `Host: ${details.host}`,
    `Timestamp: ${details.timestamp}`,
  ].join('\n');

  return createIssueComment(env, repo, issueNumber, commentBody);
}

export async function logHealthStatusToGitHub(
  env: AnyEnv,
  body: string,
  overrideRepo?: string | null,
  overrideIssue?: number | null
): Promise<GitHubRequestResult> {
  const repo = resolveRepoFromEnv(env, overrideRepo ?? ((env as AnyEnv).GITHUB_HEALTH_LOG_REPO as string | undefined));

  const issueNumberSource =
    overrideIssue ??
    (typeof (env as AnyEnv).GITHUB_HEALTH_LOG_ISSUE === 'string'
      ? Number.parseInt((env as AnyEnv).GITHUB_HEALTH_LOG_ISSUE as string, 10)
      : Number((env as AnyEnv).GITHUB_HEALTH_LOG_ISSUE));

  if (!repo || !Number.isFinite(issueNumberSource) || issueNumberSource <= 0) {
    return { ok: false, status: 400, error: 'health-log-target-missing', skipped: true };
  }

  return createIssueComment(env, repo, issueNumberSource, body);
}

