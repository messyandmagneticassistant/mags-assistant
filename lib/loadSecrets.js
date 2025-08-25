const fs = require("fs");
const path = require("path");

function loadSecrets() {
  try {
    const blob = process.env.SECRETS_BLOB;
    if (blob) {
      const secrets = JSON.parse(blob);
      for (const [key, value] of Object.entries(secrets)) {
        const k = key === 'neuter' ? 'NEUTER' : key;
        process.env[k] = value;
      }
      console.log("✅ Secrets loaded from SECRETS_BLOB");
      return;
    }
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      require("dotenv").config({ path: envPath });
      console.log("⚠️ Loaded secrets from local .env fallback");
    }
  } catch (err) {
    console.error("❌ Failed to load SECRETS_BLOB, rolling back:", err);
    try {
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        require("dotenv").config({ path: envPath });
        console.log("⚠️ Loaded secrets from .env after failure");
      }
    } catch (rollbackErr) {
      console.error("❌ Rollback also failed:", rollbackErr);
    }
  }
}

loadSecrets();

module.exports = loadSecrets;
