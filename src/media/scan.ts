import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegBin from 'ffmpeg-static';
import * as tf from '@tensorflow/tfjs-node';
import * as nsfw from 'nsfwjs';
import sharp from 'sharp';
import Filter from 'bad-words';
import compromise from 'compromise';
import { parseFile } from 'music-metadata';

ffmpeg.setFfmpegPath(ffmpegBin as string);

let model: nsfw.NSFWJS | null = null;
async function getModel() {
  if (!model) model = await nsfw.load();
  return model;
}

function normalizeText(txt: string) {
  const map: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
  return txt
    .toLowerCase()
    .replace(/[013457@\$]/g, c => map[c] || '')
    .replace(/\*/g, '')
    .replace(/[^a-z\s]/g, ' ');
}

async function extractFrames(file: string): Promise<string[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frames-'));
  return new Promise((resolve, reject) => {
    ffmpeg(file)
      .outputOptions(['-vf', 'fps=1'])
      .output(path.join(tmpDir, 'frame-%02d.jpg'))
      .on('end', () => {
        const files = fs
          .readdirSync(tmpDir)
          .filter(f => f.endsWith('.jpg'))
          .slice(0, 60)
          .map(f => path.join(tmpDir, f));
        resolve(files);
      })
      .on('error', reject)
      .run();
  });
}

function calcSkinRatio(buf: Buffer, width: number, height: number) {
  let skin = 0;
  for (let i = 0; i < buf.length; i += 3) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15 && r - g > 15) skin++;
  }
  return skin / (width * height);
}

export interface ScanResult {
  nsfwMax: number;
  nsfwClasses: Record<string, number>;
  skinRatioMax: number;
  profanityHits: string[];
  hasAudio: boolean;
  framesChecked: number;
}

export async function scanVideo(localPath: string, caption: string): Promise<ScanResult> {
  const nsfwClasses: Record<string, number> = {};
  let nsfwMax = 0;
  let skinRatioMax = 0;
  let framesChecked = 0;

  try {
    const frameFiles = await extractFrames(localPath);
    const m = await getModel();
    for (const file of frameFiles) {
      const img = fs.readFileSync(file);
      const tensor = tf.node.decodeImage(img, 3);
      const predictions = await m.classify(tensor as any);
      tensor.dispose();
      framesChecked++;
      for (const p of predictions) {
        nsfwClasses[p.className] = Math.max(nsfwClasses[p.className] || 0, p.probability);
        nsfwMax = Math.max(nsfwMax, p.probability);
      }
      const { data, info } = await sharp(img).resize(320, 320).raw().toBuffer({ resolveWithObject: true });
      const ratio = calcSkinRatio(data, info.width, info.height);
      skinRatioMax = Math.max(skinRatioMax, ratio);
    }
  } catch (err) {
    console.error('[scanVideo] ffmpeg/nsfw error', err);
  }

  const filter = new Filter();
  const doc = compromise(normalizeText(caption));
  const words = doc.text().split(/\s+/);
  const profanityHits = words.filter(w => w && filter.isProfane(w));

  let hasAudio = false;
  try {
    const meta = await parseFile(localPath);
    hasAudio = (meta.format.numberOfAudioTracks || 0) > 0 || (meta.format.numberOfChannels || 0) > 0;
  } catch {
    hasAudio = false;
  }

  return {
    nsfwMax,
    nsfwClasses,
    skinRatioMax,
    profanityHits,
    hasAudio,
    framesChecked,
  };
}
