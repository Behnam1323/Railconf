const http = require("http");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 8080);
const XRAY_PORT = Number(process.env.XRAY_PORT || 10000);
const WS_PATH = process.env.WS_PATH || "/api/ws";
const UUID = process.env.UUID || crypto.randomUUID();
const DOMAIN = process.env.DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

const CONFIG_PATH = "/tmp/xray-config.json";

function log(...args) {
  console.log("[gateway]", ...args);
}

function buildXrayConfig() {
  return {
    log: { loglevel: process.env.XRAY_LOGLEVEL || "warning" },
    inbounds: [{
      listen: "127.0.0.1",
      port: XRAY_PORT,
      protocol: "vless",
      settings: {
        clients: [{ id: UUID, email: "railway-vless" }],
        decryption: "none"
      },
      streamSettings: {
        network: "ws",
        security: "none",
        wsSettings: {
          path: WS_PATH,
          headers: { Host: "localhost" }
        }
      }
    }],
    outbounds: [{
      protocol: "freedom",
      settings: { domainStrategy: "AsIs" }
    }]
  };
}

function makeUri() {
  if (!DOMAIN) return null;
  const params = new URLSearchParams({
    encryption: "none",
    security: "tls",
    type: "ws",
    host: DOMAIN,
    path: WS_PATH,
    sni: DOMAIN,
    fp: "chrome"
  });
  return `vless://${UUID}@${DOMAIN}:443?${params.toString()}#Railway-Xray-WS`;
}

function writeConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(buildXrayConfig(), null, 2));
}

function startXray() {
  writeConfig();
  const child = spawn("xray", ["run", "-config", CONFIG_PATH], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", d => process.stdout.write("[xray] " + d.toString()));
  child.stderr.on("data", d => process.stderr.write("[xray] " + d.toString()));
  child.on("exit", (code, signal) => {
    console.error(`[xray] exited code=${code} signal=${signal}`);
    process.exit(code || 1);
  });

  return child;
}

const xray = startXray();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/" || url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({
      ok: true,
      service: "railway-xray-vless-ws",
      xray: "running",
      wsPath: WS_PATH,
      domainConfigured: Boolean(DOMAIN),
      message: DOMAIN
        ? "VLESS/WS is ready. Railway provides TLS on the public domain."
        : "Set DOMAIN to your Railway public domain."
    }));
  }

  if (url.pathname === "/api/config") {
    if (!ADMIN_TOKEN || url.searchParams.get("token") !== ADMIN_TOKEN) {
      res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({
      ok: true,
      protocol: "vless",
      transport: "ws",
      security: "tls",
      uuid: UUID,
      domain: DOMAIN || null,
      port: 443,
      path: WS_PATH,
      sni: DOMAIN || null,
      fingerprint: "chrome",
      uri: makeUri()
    }, null, 2));
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
});

const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  if (pathname !== WS_PATH) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (client) => {
    wss.emit("connection", client, req);
  });
});

wss.on("connection", (client, req) => {
  const upstreamUrl = `ws://127.0.0.1:${XRAY_PORT}${WS_PATH}`;
  const headers = {};
  if (req.headers.host) headers["x-forwarded-host"] = req.headers.host;
  if (req.headers["user-agent"]) headers["x-forwarded-user-agent"] = req.headers["user-agent"];

  const upstream = new WebSocket(upstreamUrl, { headers, perMessageDeflate: false });

  const closeBoth = () => {
    try { client.close(); } catch {}
    try { upstream.close(); } catch {}
  };

  upstream.on("open", () => {
    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      }
    });
  });

  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });

  client.on("close", closeBoth);
  client.on("error", closeBoth);
  upstream.on("close", closeBoth);
  upstream.on("error", (err) => {
    console.error("[ws-upstream]", err.message);
    closeBoth();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  log(`HTTP/WS gateway listening on 0.0.0.0:${PORT}`);
  log(`Xray inbound: 127.0.0.1:${XRAY_PORT}${WS_PATH}`);
  log(`DOMAIN=${DOMAIN || "(not set)"}`);
  log(`UUID=${UUID}`);
  if (makeUri()) log(`VLESS URI: ${makeUri()}`);
  else log("Set DOMAIN after generating Railway domain; then redeploy.");
});

process.on("SIGTERM", () => {
  try { xray.kill("SIGTERM"); } catch {}
  server.close(() => process.exit(0));
});
