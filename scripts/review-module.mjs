import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { server } from '../server/index.js';

const moduleName = String(process.argv[2] || '').trim();
if (!/^[a-z0-9-]+$/.test(moduleName)) {
  throw new Error('Usage: node scripts/review-module.mjs <module-name>');
}

const entryPath = new URL(`../modules/${moduleName}/index.html`, import.meta.url);
await access(entryPath);

const port = Number(process.env.PORT) || 4174;
const url = `http://localhost:${port}/modules/${moduleName}/index.html`;

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Set another port and retry.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(port, () => {
  console.log(`Reviewing ${moduleName}: ${url}`);
  openBrowser(url);
});

function openBrowser(target) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
}

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
