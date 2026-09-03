// WS 冒烟：连接房间 WebSocket，收 history/presence 后发一条弹幕并等待回显。
// 用法: node scripts/ws-smoke.mjs <roomId> <token> [baseUrl 默认 http://localhost:8081]
// 成功打印 WS_SMOKE_PASS 并 exit 0；20 秒超时打印 WS_SMOKE_FAIL 并 exit 1。

const roomId = process.argv[2];
const token = process.argv[3];
const baseUrl = process.argv[4] || "http://localhost:8081";

if (!roomId || !token) {
  console.error("用法: node scripts/ws-smoke.mjs <roomId> <token> [baseUrl]");
  process.exit(1);
}

const wsUrl = baseUrl.replace(/^http/, "ws") + `/ws?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`;

const TIMEOUT_MS = 20_000;
const timer = setTimeout(() => {
  console.log("WS_SMOKE_FAIL");
  process.exit(1);
}, TIMEOUT_MS);

function finish() {
  clearTimeout(timer);
  console.log("WS_SMOKE_PASS");
  process.exit(0);
}

const ws = new WebSocket(wsUrl);
let gotHistory = false;
let sent = false;

ws.onopen = () => {
  console.log(`connected: ${wsUrl}`);
};

ws.onmessage = (event) => {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }

  if (msg.type === "history" && !gotHistory) {
    gotHistory = true;
    console.log("history:", JSON.stringify(msg.messages));
  } else if (msg.type === "presence" && gotHistory && !sent) {
    sent = true;
    const content = `ws-smoke-${Date.now()}`;
    ws.send(JSON.stringify({ type: "chat", content }));
  } else if (msg.type === "chat" && typeof msg.content === "string" && msg.content.startsWith("ws-smoke-")) {
    console.log("echo:", JSON.stringify(msg));
    finish();
  }
};

ws.onerror = () => {
  clearTimeout(timer);
  console.log("WS_SMOKE_FAIL");
  process.exit(1);
};

ws.onclose = () => {
  if (!sent) {
    clearTimeout(timer);
    console.log("WS_SMOKE_FAIL");
    process.exit(1);
  }
};
