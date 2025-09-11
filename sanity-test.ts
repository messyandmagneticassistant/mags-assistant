import { schedule } from './src/social/scheduler';

async function main() {
  const whenISO = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  await schedule({
    fileUrl: 'https://example.com/demo.mp4',
    caption: 'sanity test',
    whenISO,
  });
  console.log('sanity ok');
}

main();
