import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function proxyConnection(clientWs, request) {
  const url = new URL(request.url || "/", "http://localhost");
  const pin = url.searchParams.get("pin");
  const token = url.searchParams.get("token");

  if (!pin || !token || !/^\d{6,}$/.test(pin)) {
    clientWs.close(1008, "Missing pin or token");
    return;
  }

  const kahootUrl = `wss://kahoot.it/cometd/${encodeURIComponent(pin)}/${encodeURIComponent(token)}`;
  const pending = [];
  const kahootWs = new WebSocket(kahootUrl, {
    headers: {
      Origin: "https://kahoot.it",
      Cookie: `no.mobitroll.session=${pin}`,
      "User-Agent": USER_AGENT,
    },
  });

  const forwardToKahoot = (data) => {
    if (kahootWs.readyState === WebSocket.OPEN) {
      kahootWs.send(data);
    } else {
      pending.push(data);
    }
  };

  kahootWs.on("open", () => {
    for (const message of pending) {
      kahootWs.send(message);
    }
    pending.length = 0;
  });

  kahootWs.on("message", (data) => {
    try {
      clientWs.send(data);
    } catch {
      // ignore
    }
  });

  clientWs.on("message", (data) => {
    forwardToKahoot(data);
  });

  kahootWs.on("close", () => {
    try {
      clientWs.close();
    } catch {
      // ignore
    }
  });

  clientWs.on("close", () => {
    try {
      kahootWs.close();
    } catch {
      // ignore
    }
  });

  kahootWs.on("error", () => {
    try {
      clientWs.close(1011, "Kahoot socket error");
    } catch {
      // ignore
    }
  });

  clientWs.on("error", () => {
    try {
      kahootWs.close(1011, "Client socket error");
    } catch {
      // ignore
    }
  });
}

const server = createServer((req, res) => {
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("WebSocket upgrade required");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (clientWs, request) => {
  proxyConnection(clientWs, request);
});

export default server;
