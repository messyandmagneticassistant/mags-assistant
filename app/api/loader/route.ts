export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const neuterParam = url.searchParams.get('neuter');
  if (neuterParam !== null) {
    const neuter = /^(1|true)$/i.test(neuterParam);
    process.env.NEUTER = String(neuter);
  }
  const hasBlob = !!process.env.SECRETS_BLOB;
  const hasGCreds = !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !!process.env.GOOGLE_CREDENTIALS_JSON;
  const neuter = process.env.NEUTER === 'true';
  return Response.json({ ok: true, hasBlob, hasGCreds, neuter });
}
