// 단일 실행기 — 로컬 서버 기동 + 브라우저로 ETF 탐색 화면 자동 열기.
// 실행:  npm run explore   또는   start-etf.cmd 더블클릭
// 종료:  Ctrl+C  또는  실행 창 닫기  (단일 프로세스라 창을 닫으면 서버도 함께 종료됨)
//
// 왜 필요한가: etf-explore.html 은 ES 모듈(type="module")과 /api 데이터를 사용하므로
// 파일을 그냥 더블클릭(file://)하면 브라우저 보안 때문에 공란으로 뜬다. 반드시 http 서버로 열어야 한다.
import { spawn } from 'node:child_process';
import { server } from '../server/index.js';
import { describeConfig } from '../server/config.js';

const PORT = Number(process.env.PORT) || 4173;
const exploreUrl = `http://localhost:${PORT}/etf-explore.html`;
const hubUrl = `http://localhost:${PORT}/`;
const reverseSearchUrl = `http://localhost:${PORT}/reverse-search/`;
// npm run reverse-search → 역검색 화면을 연다(그 외엔 기존대로 탐색 화면).
const openUrl = process.argv.includes('--reverse-search') ? reverseSearchUrl : exploreUrl;

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(
      `\n[안내] 포트 ${PORT} 가 이미 사용 중입니다.\n` +
      `       stop-etf.cmd 로 기존 서버를 종료한 뒤 다시 실행하거나,\n` +
      `       다른 포트로 실행하세요:  set PORT=4180 && npm run explore\n`
    );
    process.exit(1);
  }
  throw err;
});

// 서버를 이 프로세스에서 직접 listen — 자식 프로세스 없음(고아 방지).
server.listen(PORT, () => {
  const d = describeConfig();
  console.log(
    `\n============================================================\n` +
    `  ETF Hub 실행 중  [mode=${d.mode}]\n` +
    `   - ETF 탐색 : ${exploreUrl}\n` +
    `   - 메인 허브: ${hubUrl}\n` +
    `  종료: 이 창을 닫거나 Ctrl+C\n` +
    `============================================================\n`
  );
  openBrowser(openUrl);
});

function openBrowser(u) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', u], { stdio: 'ignore', detached: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [u], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [u], { stdio: 'ignore', detached: true }).unref();
  } catch {
    console.log(`브라우저 자동 열기 실패 — 아래 주소를 직접 여세요:\n  ${u}`);
  }
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
