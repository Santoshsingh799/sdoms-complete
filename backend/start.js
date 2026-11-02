import { execFileSync } from 'node:child_process';

execFileSync('npx', ['prisma', 'db', 'push', '--accept-data-loss'], { stdio: 'inherit' });
if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO_DATA === 'true') {
  execFileSync('node', ['prisma/seed.js'], { stdio: 'inherit' });
}
await import('./src/server.js');
