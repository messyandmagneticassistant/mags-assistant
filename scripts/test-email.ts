import { sendEmail, getEmailConfig } from "../utils/email";

async function main() {
  const env = process.env;
  const { fromEmail } = getEmailConfig();
  const to = env.TEST_EMAIL_TO || env.TELEGRAM_FALLBACK_EMAIL || fromEmail;
  try {
    const res = await sendEmail(
      {
        to,
        subject: "Maggie test",
        text: "Hi! This is a Maggie Resend smoke test.",
        html: "<p>Hi! This is a <b>Maggie</b> Resend smoke test.</p>",
      },
      env
    );
    console.log("Email sent", res);
  } catch (err) {
    console.error("Email failed", err);
    process.exit(1);
  }
}

main();
