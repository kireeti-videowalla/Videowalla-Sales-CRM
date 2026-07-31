/**
 * Creates the first owner account.
 *
 * There is no public sign-up in this product, so this is the only way to get
 * the first user in. Everyone after that joins by invitation.
 *
 * Usage:
 *   npm run bootstrap:owner
 *   npm run bootstrap:owner -- --email kireeti@videowalla.co --name "Kireeti" --password '...'
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env', quiet: true });

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/crypto';
import { validatePassword } from '../src/lib/auth/service';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const email = (arg('email') ?? (await rl.question('Owner email: '))).trim().toLowerCase();
    if (!email.includes('@')) throw new Error('That is not a valid email address.');

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing?.status === 'ACTIVE') {
      console.log(`\nAn active account already exists for ${email}. Nothing to do.`);
      return;
    }

    const name = (arg('name') ?? (await rl.question('Full name: '))).trim();
    if (!name) throw new Error('A name is required.');

    const password = arg('password') ?? (await rl.question('Password (min 12 chars, upper, lower, number): '));
    const passwordError = validatePassword(password);
    if (passwordError) throw new Error(passwordError);

    const passwordHash = await hashPassword(password);

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { name, role: 'OWNER', status: 'ACTIVE', passwordHash, deactivatedAt: null },
        })
      : await prisma.user.create({
          data: { email, name, role: 'OWNER', status: 'ACTIVE', passwordHash },
        });

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'user.bootstrapped', entity: 'User', entityId: user.id },
    });

    console.log(`\n✓ Owner account ready: ${user.email}`);
    console.log('\nNext steps:');
    console.log('  1. npm run seed            — install the default configuration');
    console.log('  2. npm run dev             — start the app and sign in');
    console.log('  3. npm run worker          — start the background automation (separate terminal)');
    console.log('  4. Invite your salesperson from Settings → Team, and set her schedule and pay.');
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
