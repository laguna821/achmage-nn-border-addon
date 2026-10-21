// Tiny Chrome DevTools Protocol client for driving the isolated Obsidian.
// Usage: node cdp.mjs eval "<js expression>"   |   node cdp.mjs shot <file.png> [x y w h]   |   node cdp.mjs quit
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const PORT = process.env.CDP_PORT || "9333";

async function pageTarget() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const wanted = process.env.CDP_TITLE;
  const page = wanted
    ? targets.find((t) => t.type === "page" && t.title.includes(wanted))
    : targets.find((t) => t.type === "page" && t.url.includes("index.html")) ?? targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target: " + JSON.stringify(targets.map((t) => [t.type, t.url])));
  return page;
}

export async function connect() {
  const target = await pageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , command, ...args] = process.argv;
  const client = await connect();
  try {
    if (command === "quit") {
      // Normal app shutdown; the reply may not arrive once the app is gone.
      client.evaluate('setTimeout(() => require("@electron/remote").app.quit(), 100), "quitting"').catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log("quit requested");
    } else if (command === "eval") {
      const value = await client.evaluate(args[0]);
      console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    } else if (command === "shot") {
      const [file, x, y, w, h] = args;
      const params = { format: "png" };
      if (w) params.clip = { x: +x, y: +y, width: +w, height: +h, scale: 2 };
      const { data } = await client.send("Page.captureScreenshot", params);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      console.log("saved", file);
    }
  } finally {
    client.close();
  }
}
