// Seed the erxes owner account before core-api opens its public-facing listener.
//
// erxes exposes `usersCreateOwner` to anonymous callers for as long as the
// `users` collection is empty, so a freshly deployed instance hands full
// administrative control to whoever loads the page first.  This script closes
// that window from inside the container: it boots core-api on a loopback-only
// port, calls the app's own mutation, and exits.  Once a user row exists the
// mutation answers `Access denied`, so the step is naturally idempotent and
// needs no marker file.
//
// Run by docker-entrypoint.sh; never part of the serving process.

import { spawn } from 'node:child_process';
import process from 'node:process';

const BOOTSTRAP_PORT = Number(process.env.ERXES_BOOTSTRAP_PORT || 3399);
const EMAIL = (process.env.ERXES_OWNER_EMAIL || '').trim().toLowerCase();
const PASSWORD = process.env.ERXES_OWNER_PASSWORD || '';
const FIRST_NAME = process.env.ERXES_OWNER_FIRST_NAME || 'Owner';
const LAST_NAME = process.env.ERXES_OWNER_LAST_NAME || '';
const MONGO_URL = process.env.MONGO_URL || '';

const log = (msg) => console.log(`[seed-owner] ${msg}`);

if (!EMAIL || !PASSWORD) {
  log('ERXES_OWNER_EMAIL / ERXES_OWNER_PASSWORD not set — skipping.');
  process.exit(0);
}

if (!/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}$/.test(PASSWORD)) {
  // erxes rejects such a password inside the mutation; failing here makes the
  // reason visible instead of burying it in a GraphQL error at the end.
  log(
    'ERXES_OWNER_PASSWORD must be at least 8 characters and contain an ' +
      'uppercase letter, a lowercase letter and a digit — skipping.',
  );
  process.exit(0);
}

// --- Does an account already exist? -----------------------------------------
// mongodb ships in the image as a mongoose dependency (pnpm --shamefully-hoist
// puts it at the top level of node_modules).
const { MongoClient } = await import('mongodb');

const countUsers = async () => {
  const client = new MongoClient(MONGO_URL, { family: 4 });
  try {
    await client.connect();
    return await client.db().collection('users').countDocuments({}, { limit: 1 });
  } finally {
    await client.close().catch(() => {});
  }
};

let existing;
try {
  existing = await countUsers();
} catch (e) {
  log(`could not reach MongoDB (${e.message}) — skipping, the app will retry.`);
  process.exit(0);
}

if (existing > 0) {
  log('an account already exists — nothing to seed.');
  process.exit(0);
}

// --- Boot core-api on a loopback-only port -----------------------------------
log(`no accounts found; starting core-api on 127.0.0.1:${BOOTSTRAP_PORT} to seed the owner.`);

const child = spawn(process.execPath, ['dist/src/main.js'], {
  cwd: '/app',
  env: { ...process.env, PORT: String(BOOTSTRAP_PORT) },
  stdio: ['ignore', 'inherit', 'inherit'],
});

let childExited = false;
child.on('exit', (code) => {
  childExited = true;
  log(`bootstrap instance exited with code ${code}`);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${BOOTSTRAP_PORT}`;

const waitForHealth = async () => {
  for (let i = 0; i < 120; i++) {
    if (childExited) return false;
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return true;
    } catch {
      /* not listening yet */
    }
    await sleep(1000);
  }
  return false;
};

const shutdown = async () => {
  if (childExited) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 20 && !childExited; i++) await sleep(500);
  if (!childExited) child.kill('SIGKILL');
};

const MUTATION = `mutation ($email: String!, $password: String!, $firstName: String!, $lastName: String) {
  usersCreateOwner(email: $email, password: $password, firstName: $firstName, lastName: $lastName)
}`;

try {
  if (!(await waitForHealth())) {
    log('bootstrap instance never became healthy — leaving the owner unseeded.');
    await shutdown();
    process.exit(0);
  }

  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // getSubdomain() reads this header first; core-api is single-tenant here
      // (VERSION=os) but the value still has to parse.
      hostname: 'localhost',
    },
    body: JSON.stringify({
      query: MUTATION,
      variables: {
        email: EMAIL,
        password: PASSWORD,
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
      },
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (body?.errors?.length) {
    // `Access denied` means somebody won the race; anything else is a real bug
    // but must not block the deployment.
    log(`owner not created: ${body.errors.map((e) => e.message).join('; ')}`);
  } else {
    log(`owner ${EMAIL} created.`);
  }
} catch (e) {
  log(`seeding failed: ${e.message}`);
} finally {
  await shutdown();
}

process.exit(0);
