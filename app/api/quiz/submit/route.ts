import { createMagnetKit } from '../../../../lib/magnet-kit';
import { routeQuizSubmission } from '../../../../quiz/router';
import { generateMagnetBundle, type MagnetBundleProfile } from '../../../../maggie/core/generateMagnetBundle';

export const runtime = 'nodejs';

/**
 * Handle quiz submissions. This is a lightweight orchestration layer
 * that triggers the reading and magnet kit generation pipelines. It
 * stubs external integrations (Notion, Drive, Telegram, Email).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as any;
  const userId = body.userId || 'anon';

  const children = Array.isArray(body.children)
    ? body.children
    : Array.isArray(body.kids)
      ? body.kids
      : undefined;

  const normalizedChildren = Array.isArray(children)
    ? children
        .map((child: any) => ({
          name: child?.name,
          age: child?.ageRange || child?.age,
          humanDesignType: child?.humanDesignType || child?.hdType || child?.design,
          sensitivity: child?.sensitivity || child?.notes,
        }))
        .filter((child) => Object.keys(child).some((key) => (child as any)[key]))
    : undefined;

  const profile: MagnetBundleProfile = {
    id: userId,
    name: body.name || body.fullName || body.displayName,
    household: body.household || body.householdType,
    householdRole: body.role || body.householdRole,
    humanDesignType: body.humanDesignType || body.hdType || body.design,
    lifeType: body.lifeType || body.primaryRhythm || body.focus,
    age: body.age,
    children: normalizedChildren,
    quizResults: body.quiz || body.answers || body.reading || {},
    quizTags: Array.isArray(body.quizTags)
      ? body.quizTags
      : Array.isArray(body.tags)
        ? body.tags
        : undefined,
    soulBlueprint: body.soulBlueprint || body.blueprint,
    customNeeds: body.customNeeds || body.supportNeeds || body.needs,
    neurodivergence: body.neurodivergence,
    sensitivities: body.sensitivities,
    focusAreas: body.focusAreas || (Array.isArray(body.focus) ? body.focus : undefined),
    goals: body.goals,
    requestedBy: 'quiz',
    contact: {
      email: body.email,
      telegram: body.telegram,
    },
  };

  // 1. Generate a magnet bundle tuned to the quiz profile
  const bundle = await generateMagnetBundle(profile, { requestedBy: 'quiz', persist: true });

  // 2. Build magnet kit using desired format and suggested icons
  const format = body.format || 'pdf';
  const kit = await createMagnetKit({
    userId,
    icons: bundle.icons.map((icon) => icon.slug),
    format,
  });

  // 3. Route the user to the correct product
  const route = routeQuizSubmission({
    household: body.household || 'Solo',
    format: body.formatChoice || 'Digital',
    tier: body.tier || 'Basic',
  });

  // 4. Stub saving to Notion/Drive and sending confirmations
  console.log('Save to Notion + Drive', { userId, bundle, kit });
  console.log('Send confirmation', { userId, route });

  return Response.json({ ok: true, bundle, kit, route });
}
