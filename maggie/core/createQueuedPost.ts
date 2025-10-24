// maggie/core/createQueuedPost.ts

import path from 'path';
import fs from 'fs/promises';
import crypto from 'node:crypto';
import { log } from '../shared/logger';
import { generateCaptionAndOverlay } from '../core/generateCaption';
import { slugify } from '../../utils/slugify.ts';

export type QueuedPost = {
  id: string;
  title: string;
  slug: string;
  createdAt: string;
  videoPath: string;
  caption: string;
  overlay: string;
  hashtags: string[];
  firstComment?: string;
  status: 'queued' | 'posted' | 'error';
};

export async function createQueuedPost({
  path: videoPath,
  originalName,
}: {
  path: string;
  originalName: string;
}): Promise<QueuedPost> {
  const id = crypto.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  const createdAt = new Date().toISOString();
  const title = originalName.replace(/\.[^/.]+$/, '');
  const slug = slugify(title);

  const { caption, overlay, hashtags, firstComment } = await generateCaptionAndOverlay({ title });

  const post: QueuedPost = {
    id,
    title,
    slug,
    createdAt,
    videoPath,
    caption,
    overlay,
    hashtags,
    firstComment,
    status: 'queued',
  };

  const outputPath = `queue/${slug}.json`;
  await fs.mkdir('queue', { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(post, null, 2));

  log(`[createQueuedPost] Saved to ${outputPath}`);
  return post;
}