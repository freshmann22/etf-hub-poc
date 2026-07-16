// 통합 서버 — 정적 파일(etf-explore.html·src/**) + /api 데이터 공급 API.
// 외부 의존성 없음(node: 내장만). `npm run serve` 진입점.
// mock 모드에서는 자격 없이도 전 기능 동작하고, .env 에 자격을 넣으면 live/hybrid 로 승격된다.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from './routes/api.js';
import { config, describeConfig } from './config.js';

const root = fileURLToPath(new URL('..', import.meta.url)); // 프로젝트 루트
const port = Number(process.env.PORT) || config.port || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res) {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const rel = urlPath === '/' ? 'etf-explore.html' : urlPath.replace(/^\/+/, '');
    const filePath = normalize(join(root, rel));
    if (!filePath.startsWith(normalize(root))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

export const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleApiRequest(req, res);
    if (handled) return;
    await serveStatic(req, res);
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Internal Server Error');
  }
});

// 이 파일이 직접 실행될 때만 listen(테스트에서 import 시 자동 기동 방지).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  server.listen(port, () => {
    const d = describeConfig();
    console.log(`etf-hub server: http://localhost:${port}  [mode=${d.mode}]`);
    // 비밀값 없이 provider 설정 상태만 출력.
    console.log('providers:', JSON.stringify(d.providers));
  });
}

export default server;
