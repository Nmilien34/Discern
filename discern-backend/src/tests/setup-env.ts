// Runs BEFORE any test file's imports, which is what makes it effective:
// config/env.ts validates at import time, so by the time a test pulls in the app
// the environment is already this one and not the developer's.
//
// Two jobs, and the second is the important one.
//
// 1. Satisfy the schema. Required keys must be present or every test that
//    touches the app dies in env.ts rather than in the assertion it was written
//    for.
//
// 2. GUARANTEE NO REAL PROVIDER CALL. Developer-local keys are OVERWRITTEN here,
//    not defaulted — a test run must not be able to reach OpenAI or ElevenLabs
//    even when a real .env is present and loaded. ElevenLabs bills per
//    character, so a stray synthesis in a watch-mode loop is a real invoice, and
//    the sentinel values below are syntactically fine and cryptographically
//    useless: any client built from them fails authentication instead of
//    spending money.
//
// Assignment is unconditional on purpose. `??=` would preserve whatever the
// developer had loaded, which is exactly the failure this file exists to prevent.

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";

process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/discern-test";
process.env.MONGODB_DB_NAME = "discern-test";

process.env.OPENAI_API_KEY = "test-openai-key-not-a-real-credential";
process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key-not-a-real-credential";

process.env.AWS_ACCESS_KEY_ID = "test-aws-access-key-id";
process.env.AWS_SECRET_ACCESS_KEY = "test-aws-secret-access-key";
process.env.AWS_REGION = "us-east-2";
process.env.S3_BUCKET = "discern-audio-test";

process.env.REVENUECAT_WEBHOOK_SECRET = "test-revenuecat-webhook-secret";
process.env.REVENUECAT_SECRET_API_KEY = "test-revenuecat-api-key";

// The audience Sign in with Apple tokens are checked against. Verification
// refuses to run without it, so tests that exercise the happy path need one.
process.env.APPLE_BUNDLE_ID = "com.boltzman.discern";

// Real 32 bytes so the strength validation is exercised rather than bypassed.
process.env.JWT_SECRET =
  "9f2c41ab7e6d0538c1a4be97f20d6c8b35ea71904dc26f8b1e5a3097cb42de60";
