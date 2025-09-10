import { schedule } from './src/social/scheduler';

async function main() {
  await schedule({ fileUrl: 'https://example.com/video.mp4', caption: 'test', whenISO: new Date().toISOString() });
  console.log('sanity ok');
}

main();
