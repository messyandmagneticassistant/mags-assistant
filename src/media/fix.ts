import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegBin from 'ffmpeg-static';
import Filter from 'bad-words';
import { POLICY } from './policy';

ffmpeg.setFfmpegPath(ffmpegBin as string);

function tmpPath(suffix: string) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fix-')), `out${suffix}.mp4`);
}

export interface FixResult {
  pathOut: string;
  changed: boolean;
  notes: string[];
}

async function runFfmpeg(cmd: ffmpeg.FfmpegCommand, out: string) {
  return new Promise<string>((resolve, reject) => {
    cmd.output(out).on('end', () => resolve(out)).on('error', reject).run();
  });
}

export async function autoFix(localPath: string, caption: string): Promise<{ fixed: FixResult; newCaption: string }> {
  let pathOut = localPath;
  let changed = false;
  const notes: string[] = [];

  // probe metadata
  const meta = await new Promise<any>((resolve) => {
    ffmpeg(pathOut).ffprobe((_, data) => resolve(data));
  });

  const videoStream = (meta.streams || []).find((s: any) => s.codec_type === 'video');
  const duration = Number(videoStream?.duration || meta.format?.duration || 0);
  if (duration > POLICY.maxSeconds) {
    const start = Math.max(0, (duration - POLICY.maxSeconds) / 2);
    const out = tmpPath('trim');
    await runFfmpeg(ffmpeg(pathOut).setStartTime(start).setDuration(POLICY.maxSeconds), out);
    pathOut = out;
    changed = true;
    notes.push('trimmed');
  }

  const width = videoStream?.width || 0;
  const height = videoStream?.height || 0;
  if (width && height && Math.abs(width / height - 9 / 16) > 0.01) {
    const out = tmpPath('crop');
    const vf = 'scale=1080:-1:force_original_aspect_ratio=increase,crop=1080:1920';
    await runFfmpeg(ffmpeg(pathOut).videoFilters(vf), out);
    pathOut = out;
    changed = true;
    notes.push('crop');
  }

  // always apply mild blur when fixing
  {
    const out = tmpPath('blur');
    await runFfmpeg(ffmpeg(pathOut).videoFilters('boxblur=10:1'), out);
    pathOut = out;
    changed = true;
    notes.push('blur');
  }

  // audio normalize if audio stream exists
  const hasAudio = (meta.streams || []).some((s: any) => s.codec_type === 'audio');
  if (hasAudio) {
    const out = tmpPath('aud');
    const af = `loudnorm=I=${POLICY.normalizeLUFS}:LRA=11:TP=-1.5`;
    await runFfmpeg(ffmpeg(pathOut).audioFilters(af), out);
    pathOut = out;
    changed = true;
    notes.push('audio-normalized');
  }

  // caption cleanup
  let newCaption = caption;
  const filter = new Filter();
  if (POLICY.profanityBlock && filter.isProfane(caption)) {
    newCaption = filter.clean(caption);
    changed = true;
    notes.push('caption-cleaned');
  }

  return { fixed: { pathOut, changed, notes }, newCaption };
}
