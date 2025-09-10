import { scanVideo } from './scan';
import { autoFix } from './fix';
import { POLICY, SafetyStatus } from './policy';
import { mediaKV, getJSON, setJSON } from './kv';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegBin from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegBin as string);

export interface SafetyReport {
  id: string;                // stable content id (hash of file or your asset id)
  source: 'drive' | 'local' | 'url';
  status: SafetyStatus;
  reasons: string[];
  captionOut: string;
  artifactPath?: string;     // path to fixed output if changed
  metrics: {
    nsfwMax: number;
    skinRatioMax: number;
    framesChecked: number;
    hasAudio: boolean;
  };
  at: number;                // epoch ms
}

export async function ensureSafe(env: any, asset: { id: string; path: string; caption: string }): Promise<SafetyReport> {
  const lockKey = mediaKV.lock(asset.id);
  if (await env.BRAIN.get(lockKey)) {
    return (await getJSON(env, mediaKV.report(asset.id))) as SafetyReport;
  }
  await env.BRAIN.put(lockKey, '1', { expirationTtl: 900 });

  const scan0 = await scanVideo(asset.path, asset.caption);
  let status: SafetyStatus = 'approved';
  const reasons: string[] = [];
  let captionOut = asset.caption;
  let pathOut = asset.path;
  let changed = false;

  // hard blocks
  if (scan0.nsfwMax >= POLICY.nsfw.porn || (scan0.nsfwClasses['hentai'] || 0) >= POLICY.nsfw.hentai) {
    status = 'rejected';
    reasons.push('nsfw-hard');
  }
  // auto-fix path
  if (status !== 'rejected' && ((scan0.nsfwClasses['sexy'] || 0) >= POLICY.nsfw.sexy || scan0.skinRatioMax >= POLICY.skinRatioAutoFix)) {
    const fx = await autoFix(asset.path, asset.caption);
    pathOut = fx.fixed.pathOut;
    captionOut = fx.newCaption;
    changed = changed || fx.fixed.changed;
    const scan1 = await scanVideo(pathOut, captionOut);
    if (scan1.nsfwMax >= POLICY.nsfw.sexy || scan1.skinRatioMax >= POLICY.skinRatioAutoFix) {
      status = 'rejected';
      reasons.push('nsfw-after-fix');
    } else {
      status = changed ? 'fixed' : 'approved';
    }
  }

  // caption profanity → auto-clean (already done in autoFix), still record hits
  if (scan0.profanityHits.length) reasons.push('caption-cleaned');

  const report: SafetyReport = {
    id: asset.id,
    source: 'local',
    status,
    reasons,
    captionOut,
    artifactPath: pathOut !== asset.path ? pathOut : undefined,
    metrics: {
      nsfwMax: scan0.nsfwMax,
      skinRatioMax: scan0.skinRatioMax,
      framesChecked: scan0.framesChecked,
      hasAudio: scan0.hasAudio,
    },
    at: Date.now(),
  };

  await setJSON(env, mediaKV.report(asset.id), report);
  await env.BRAIN.delete(lockKey);
  return report;
}
