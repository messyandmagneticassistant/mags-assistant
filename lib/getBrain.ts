const BRAIN_ENDPOINT =
  "https://api.github.com/repos/messyandmagneticassistant/mags-assistant/contents/brain.md?ref=main";

export async function getBrain(): Promise<string> {
  const token = process.env.GITHUB_PAT;
  if (!token) {
    throw new Error("Missing GITHUB_PAT environment variable.");
  }

  try {
    const response = await fetch(BRAIN_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API responded with ${response.status}: ${body}`);
    }

    const data: { content?: string } = await response.json();
    if (!data.content) {
      throw new Error("GitHub API response did not include content.");
    }

    const normalized = data.content.replace(/\n/g, "");
    return Buffer.from(normalized, "base64").toString("utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch brain configuration: ${message}`);
  }
}
