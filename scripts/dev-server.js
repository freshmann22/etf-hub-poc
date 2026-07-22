// 로컬 정적 서버 (Fable 소유) — 외부 의존성 없음
// /api 요청은 데이터 공급 API 라우터로 위임한다(통합 서버 server/index.js 와 동일 동작).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApiRequest } from '../server/routes/api.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

http.createServer(async (req, res) => {
  try {
    if (await handleApiRequest(req, res)) return;
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
}).listen(port, () => {
  console.log(`dev server: http://localhost:${port}`);
});
