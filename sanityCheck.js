(function sanityCheck() {
  if (!process.env.SECRETS_BLOB) {
    console.error("⚠️ SECRETS_BLOB missing in environment!");
    return;
  }
  try {
    const secrets = JSON.parse(process.env.SECRETS_BLOB);
    if (!secrets || Object.keys(secrets).length === 0) {
      console.error("⚠️ SECRETS_BLOB parsed but empty.");
    } else {
      console.log("✅ SECRETS_BLOB unpacked with", Object.keys(secrets).length, "keys.");
    }
  } catch (e) {
    console.error("❌ SECRETS_BLOB failed to parse:", e);
  }
})();
