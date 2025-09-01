import { postVideo } from './worker/tiktok/uploader';
import { getProfile } from './worker/tiktok/config';

interface Env {
  BROWSERLESS_API_KEY: string;
  BROWSERLESS_BASE_URL?: string;
  [key: string]: any;
}

interface TikTokPostJob {
  type: 'tiktok.post';
  profile: string;
  videoUrl: string;
  caption: string;
  tags: string[];
}

type Message<T> = { body: T; ack(): void; retry(): void };
type MessageBatch<T> = { messages: Message<T>[] };

export default {
  async queue(batch: MessageBatch<TikTokPostJob>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const job = msg.body;
      if (job.type !== 'tiktok.post') {
        msg.ack();
        continue;
      }
      try {
        const profile = getProfile(env, job.profile);
        if (!profile) throw new Error(`unknown profile ${job.profile}`);
        await postVideo({ profile, videoUrl: job.videoUrl, caption: job.caption, tags: job.tags, env });
        msg.ack();
      } catch (e) {
        console.error('tiktok.post failed', e);
        msg.retry();
      }
    }
  },
};
