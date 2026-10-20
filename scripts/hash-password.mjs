#!/usr/bin/env node
// Generates the ADMIN_PASSWORD_HASH value for .dev.vars / `wrangler secret put`.
//
//   node scripts/hash-password.mjs [password]
//
// Output format: pbkdf2$<iterations>$<salt b64url>$<hash b64url>
// This is byte-identical to what WebCrypto PBKDF2 produces in the Worker
// (SHA-256, 256-bit derived key), so local and production hashes match.

import { pbkdf2Sync, randomBytes } from "node:crypto";
import { argv, exit } from "node:process";

const ITERATIONS = 100000;

const password = argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");

const b64url = (buf) => buf.toString("base64url");
console.log(`pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`);
