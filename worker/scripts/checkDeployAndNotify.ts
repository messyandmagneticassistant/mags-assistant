const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const PROJECT_NAME = 'messyandmagnetic';
const CLOUDFLARE_API = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments`;

async function checkDeployAndNotify() {
  try {
    const response = await fetch(CLOUDFLARE_API, {
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch deployments: ${response.statusText}`);
    }

    const data = await response.json();
    const latest = data.result?.[0];

    if (!latest) throw new Error('No deployments found.');

    const status = latest?.latest_stage?.status || 'unknown';
    const url = latest?.url;
    const commitMessage = latest?.deployment_trigger?.metadata?.commit_message || 'Unknown commit';
    const failureReason = latest?.latest_stage?.reason || latest?.fail_reason || 'No reason provided';

    let message = '';

    if (status === 'success') {
      message = `✅ Website deployed successfully: ${url}`;
    } else if (status === 'failed') {
      message = `🚨 Deploy failed for messyandmagnetic.com\n\nReason: ${failureReason}\nCommit: ${commitMessage}`;
    } else {
      message = `⚠️ Deploy status: ${status}\nCheck: ${url}`;
    }

    await sendTelegramMessage(message);
  } catch (err: any) {
    console.error('Error checking deploy:', err.message);
    await sendTelegramMessage(`⚠️ Error checking website deploy: ${err.message}`);
  }
}

async function sendTelegramMessage(text: string) {
  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'Markdown',
  };

  const res = await fetch(telegramUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error('Failed to send Telegram message:', await res.text());
  }
}

checkDeployAndNotify();
