/**
 * throttle.mjs — Chrome の CPU を指定倍率で常時スロットルする (DevTools 不要)。
 *
 * DevTools の Performance パネルの CPU throttling は DevTools を開いている間しか
 * 効かない。このスクリプトは CDP の Emulation.setCPUThrottlingRate を直接叩き、
 * 接続を維持している間ずっとスロットルを効かせ続ける。
 *
 * 依存パッケージなし (Node 18+ の fetch / Node 22 のグローバル WebSocket を使用)。
 *
 * 使い方:
 *   1. リモートデバッグを有効にして Chrome を起動する
 *      chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\stacks-profile ^
 *                 --force-device-scale-factor=1 --window-size=720,720 ^
 *                 --app=http://localhost:5173/pomodoro
 *   2. node throttle.mjs 4.2
 *      (倍率は stacks-bench.html が出した「推奨 CPU throttling 倍率」)
 *
 *   Ctrl+C で終了するとスロットルは解除される。
 */

const rate = Number(process.argv[2]);
const port = Number(process.argv[3] ?? 9222);

if (!Number.isFinite(rate) || rate < 1) {
  console.error('使い方: node throttle.mjs <倍率 (1 以上)> [デバッグポート=9222]');
  process.exit(1);
}
if (typeof WebSocket === 'undefined') {
  console.error('この Node には グローバル WebSocket がありません。Node 22 以降で実行してください。');
  process.exit(1);
}

const listUrl = `http://127.0.0.1:${port}/json/list`;

let targets;
try {
  targets = await fetch(listUrl).then((r) => r.json());
} catch {
  console.error(`${listUrl} に接続できません。Chrome を --remote-debugging-port=${port} 付きで起動してください。`);
  process.exit(1);
}

const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (pages.length === 0) {
  console.error('ページターゲットが見つかりません。Chrome でタブを開いた状態で実行してください。');
  process.exit(1);
}

console.log(`対象ページ ${pages.length} 件に CPU throttling ${rate}x を適用します。`);

let msgId = 0;
const sockets = [];

for (const page of pages) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  sockets.push(ws);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      id: ++msgId,
      method: 'Emulation.setCPUThrottlingRate',
      params: { rate }
    }));
    console.log(`  適用: ${page.title || page.url}`);
  });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.error) console.error(`  エラー: ${m.error.message}`);
  });

  ws.addEventListener('error', () => {
    console.error(`  接続失敗: ${page.url}`);
  });

  ws.addEventListener('close', () => {
    console.log(`  切断 (スロットル解除): ${page.url}`);
  });
}

console.log('接続を維持中。Ctrl+C で終了するとスロットルは解除されます。');

process.on('SIGINT', () => {
  for (const ws of sockets) {
    try { ws.close(); } catch { /* すでに閉じている */ }
  }
  process.exit(0);
});

// 接続を維持し続ける
setInterval(() => {}, 1 << 30);
