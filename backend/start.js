import { execFileSync } from 'node:child_process';

execFileSync('npx', ['prisma', 'db', 'push', '--accept-data-loss'], { stdio: 'inherit' });
execFileSync('node', ['prisma/seed.js'], { stdio: 'inherit' });
await import('./src/server.js');
