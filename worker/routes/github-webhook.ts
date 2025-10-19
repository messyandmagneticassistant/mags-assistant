import type { Env } from '../lib/env';
import { tickScheduler, wakeSchedulers } from '../scheduler';
import { syncThreadStateFromGitHub, syncBrainDocFromGitHub } from '../lib/threadStateSync';
import { loadConfig } from '../lib/config';
import { sendTelegram } from '../lib/state';
import {
  createDiscussionComment,
  createIssueComment,
  closeIssue,
  parseRepo,
  type GitHubRepo,
} from '../lib/github';

const encoder = new TextEncoder();

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...(init ?? {}),
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init?.headers ?? {}) },
  });
}

function safeJsonParse(body: string): any {
  try {
    return body ? JSON.parse(body) : {};
  } catch (err) {
    console.warn('[github-webhook] Failed to parse payload', err);
    return null;
  }
}

async function computeSignature(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return new Uint8Array(signature);
}

function hexToBytes(hex: string): Uint8Array | null {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) return null;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function verifySignature(secret: string | null, payload: string, header: string | null): Promise<boolean> {
  if (!secret) return true;
  if (!header || !header.startsWith('sha256=')) return false;
  const provided = hexToBytes(header.slice('sha256='.length));
  if (!provided) return false;
  const expected = await computeSignature(secret, payload);
  return timingSafeEqual(provided, expected);
}

type GitHubCommentCommand = {
  name: 'think' | 'sync' | 'restart' | 'post' | 'close';
  args: string;
  raw: string;
};

function extractCommand(body: string): GitHubCommentCommand | null {
  const match = body.match(/^\/maggie\s+([a-zA-Z]+)(?:\s+([\s\S]+))?$/m);
  if (!match) return null;
  const command = match[1].trim().toLowerCase();
  if (!['think', 'sync', 'restart', 'post', 'close'].includes(command)) return null;
  const args = (match[2] ?? '').trim();
  return { name: command as GitHubCommentCommand['name'], args, raw: match[0].trim() };
}

type GitHubTarget =
  | { type: 'issue' | 'pull_request'; repo: GitHubRepo; issueNumber: number; isPullRequest: boolean }
  | { type: 'discussion'; repo: GitHubRepo; discussionNumber: number };

function determineTarget(event: string, payload: any): GitHubTarget | null {
  const repo = parseRepo(payload?.repository?.full_name);
  if (!repo) return null;

  if (event === 'issue_comment') {
    const issueNumber = Number(payload?.issue?.number);
    if (!Number.isFinite(issueNumber)) return null;
    const isPullRequest = Boolean(payload?.issue?.pull_request);
    return { type: isPullRequest ? 'pull_request' : 'issue', repo, issueNumber, isPullRequest };
  }

  if (event === 'pull_request_review_comment') {
    const issueNumber = Number(payload?.pull_request?.number);
    if (!Number.isFinite(issueNumber)) return null;
    return { type: 'pull_request', repo, issueNumber, isPullRequest: true };
  }

  if (event === 'discussion_comment') {
    const discussionNumber = Number(payload?.discussion?.number);
    if (!Number.isFinite(discussionNumber)) return null;
    return { type: 'discussion', repo, discussionNumber };
  }

  return null;
}

const ALLOWED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR', 'MAINTAINER']);

function isAuthorized(association: string | null | undefined): boolean {
  if (!association) return false;
  return ALLOWED_ASSOCIATIONS.has(association.toUpperCase());
}

async function replyToTarget(
  env: Env,
  target: GitHubTarget,
  body: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (target.type === 'discussion') {
    const result = await createDiscussionComment(env as any, target.repo, target.discussionNumber, body);
    return { ok: result.ok, status: result.status, error: result.error };
  }

  const result = await createIssueComment(env as any, target.repo, target.issueNumber, body);
  return { ok: result.ok, status: result.status, error: result.error };
}

async function handleThink(env: Env) {
  const snapshot = await tickScheduler(env);
  const tasks = Array.isArray(snapshot.currentTasks)
    ? (snapshot.currentTasks as string[]).filter((task) => typeof task === 'string' && task.trim())
    : [];
  const topTasks = tasks.slice(0, 5);
  const body = [
    '🧠 Maggie recalculated her queue.',
    '',
    topTasks.length ? topTasks.map((task, idx) => `${idx + 1}. ${task}`).join('\n') : 'No active tasks.',
    '',
    `Scheduled posts: ${snapshot.scheduledPosts}`,
    `Retry queue: ${snapshot.retryQueue}`,
  ].join('\n');
  return { ok: true, body };
}

async function handleSync(env: Env) {
  const results: string[] = [];
  const errors: string[] = [];
  try {
    await syncThreadStateFromGitHub(env as any);
    results.push('thread-state');
  } catch (err) {
    errors.push(`thread-state: ${(err as Error).message ?? err}`);
  }
  try {
    await syncBrainDocFromGitHub(env as any);
    results.push('brain doc');
  } catch (err) {
    errors.push(`brain-doc: ${(err as Error).message ?? err}`);
  }

  let configKeys = 0;
  try {
    const cfg = await loadConfig(env as any);
    configKeys = Object.keys(cfg ?? {}).length;
  } catch (err) {
    errors.push(`config: ${(err as Error).message ?? err}`);
  }

  const body = [
    '🔄 Sync requested.',
    results.length ? `Updated: ${results.join(', ')}` : 'No sync completed.',
    `Config keys available: ${configKeys}`,
  ];
  if (errors.length) {
    body.push('Warnings:', ...errors.map((err) => `• ${err}`));
  }
  return { ok: errors.length === 0, body: body.join('\n') };
}

async function handleRestart(env: Env, actor: string | null) {
  const snapshot = await wakeSchedulers(env);
  const tasks = Array.isArray(snapshot.currentTasks)
    ? (snapshot.currentTasks as string[]).filter((task) => typeof task === 'string' && task.trim())
    : [];
  const topTasks = tasks.slice(0, 5).join(', ') || 'No active tasks';
  const message = actor ? `♻️ Maggie restart requested via GitHub by @${actor}.` : '♻️ Maggie restart requested via GitHub.';
  await sendTelegram(env, message);
  const body = [
    '♻️ Automation loop restarted.',
    `Current tasks: ${topTasks}`,
    `Scheduled posts: ${snapshot.scheduledPosts}`,
  ].join('\n');
  return { ok: true, body };
}

async function handlePost(env: Env, args: string) {
  const message = args.trim();
  if (!message) {
    return { ok: false, body: '⚠️ Provide a message after `/maggie post`.' };
  }
  await sendTelegram(env, `📝 GitHub → Telegram:\n${message}`);
  const truncated = message.length > 280 ? `${message.slice(0, 277)}…` : message;
  return { ok: true, body: `📨 Sent to Telegram:\n> ${truncated}` };
}

async function handleClose(env: Env, target: GitHubTarget) {
  if (target.type === 'discussion') {
    return { ok: false, body: '⚠️ Closing discussions is not supported.' };
  }
  const result = await closeIssue(env as any, target.repo, target.issueNumber, {
    reason: 'not_planned',
    allowStateReason: !target.isPullRequest,
  });
  if (!result.ok) {
    return {
      ok: false,
      body: `⚠️ Failed to close: ${result.error ?? `HTTP ${result.status}`}`,
    };
  }
  return { ok: true, body: `🔒 Closed #${target.issueNumber}.` };
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();
  const event = request.headers.get('x-github-event');
  const signature = request.headers.get('x-hub-signature-256');
  const secret = (env as any).GITHUB_WEBHOOK_SECRET || (env as any).GH_WEBHOOK_SECRET || null;

  const verified = await verifySignature(secret ? String(secret) : null, rawBody, signature);
  if (!verified) {
    return json({ ok: false, error: 'invalid-signature' }, { status: 401 });
  }

  if (!event) {
    return json({ ok: false, error: 'missing-event' }, { status: 400 });
  }

  if (event === 'ping') {
    return json({ ok: true, pong: true });
  }

  const payload = safeJsonParse(rawBody);
  if (!payload) {
    return json({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const action = payload?.action;
  if (action && action !== 'created') {
    return json({ ok: true, ignored: 'unsupported-action' });
  }

  const commentBody = payload?.comment?.body ?? payload?.review?.body ?? payload?.discussion_comment?.body;
  if (typeof commentBody !== 'string') {
    return json({ ok: true, ignored: 'no-comment-body' });
  }

  const command = extractCommand(commentBody);
  if (!command) {
    return json({ ok: true, ignored: 'no-command' });
  }

  const association =
    payload?.comment?.author_association ??
    payload?.discussion_comment?.author_association ??
    payload?.review?.author_association;
  if (!isAuthorized(association)) {
    return json({ ok: true, ignored: 'unauthorized-commenter' });
  }

  const target = determineTarget(event, payload);
  if (!target) {
    return json({ ok: false, error: 'unresolved-target' }, { status: 400 });
  }

  let result: { ok: boolean; body: string };
  try {
    switch (command.name) {
      case 'think':
        result = await handleThink(env);
        break;
      case 'sync':
        result = await handleSync(env);
        break;
      case 'restart':
        result = await handleRestart(
          env,
          payload?.comment?.user?.login ?? payload?.discussion_comment?.user?.login ?? null
        );
        break;
      case 'post':
        result = await handlePost(env, command.args);
        break;
      case 'close':
        result = await handleClose(env, target);
        break;
      default:
        result = { ok: false, body: '⚠️ Unsupported command.' };
    }
  } catch (err) {
    console.error('[github-webhook] command execution failed', err);
    result = { ok: false, body: `⚠️ Command failed: ${(err as Error).message ?? err}` };
  }

  const actorLogin =
    payload?.comment?.user?.login ??
    payload?.discussion_comment?.user?.login ??
    payload?.review?.user?.login ??
    'unknown';
  const replyLines = [`> ${command.raw}`, '', result.body, '', `_Requested by @${actorLogin}_`];
  const reply = replyLines.join('\n');
  const response = await replyToTarget(env, target, reply);

  if (!response.ok) {
    console.warn('[github-webhook] Failed to reply to command', response);
  }

  return json({ ok: result.ok, replyPosted: response.ok, status: response.status });
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  return handle(request, env);
}

