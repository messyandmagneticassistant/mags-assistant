import { generateFullCaptionBundle } from '../brains/caption-brain';

async function main() {
  const bundle = await generateFullCaptionBundle({
    persona: 'main',
    videoTheme: 'mom burnout bedtime rooster',
    tone: 'deadpan spiritual chaos',
  });

  console.log('\n📝 Caption:', bundle.caption);
  console.log('\n🏷️ Hashtags:', bundle.hashtags.join(' '));
  console.log('\n💬 First Comment:', bundle.firstComment);
  console.log('\n📌 Summary:', bundle.summary);
  console.log('\n🎬 Overlay:', bundle.overlay);
}

main().catch(console.error);