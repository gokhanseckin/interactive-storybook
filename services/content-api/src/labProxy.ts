// Local-only throttling harness. Never deploy this process.
import { createServer, request } from "node:http";
import { Transform } from "node:stream";
let sent = 0;
const reports: string[] = [];
const perAsset: Record<string, number> = {};
const upstreamPort = Number(process.env.LAB_UPSTREAM_PORT ?? 4400);
const port = Number(process.env.LAB_PORT ?? 4401);
const server = createServer((req, res) => {
  if (req.url === "/report" && req.method === "POST") {
    let text = "";
    req.on("data", (b) => {
      if (text.length < 8192) text += b.toString();
    });
    req.on("end", () => {
      reports.push(text);
      console.log(text);
      res.end("ok");
    });
    return;
  }
  if (req.url === "/stats") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ bytesSent: sent, perAsset, reports }));
    return;
  }
  if (req.url === "/reset") {
    sent = 0;
    for (const id of Object.keys(perAsset)) delete perAsset[id];
    res.end("ok");
    return;
  }
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${upstreamPort}` },
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      const throttle = new Transform({
        transform(chunk, _encoding, callback) {
          sent += chunk.length;
          const id = req.url?.split("?")[0] ?? "unknown";
          perAsset[id] = (perAsset[id] ?? 0) + chunk.length;
          setTimeout(
            () => callback(null, chunk),
            Math.ceil((chunk.length / 32768) * 1000),
          );
        },
      });
      response.pipe(throttle).pipe(res);
      res.on("close", () => {
        response.destroy();
        throttle.destroy();
      });
    },
  );
  upstream.on("error", () => {
    res.statusCode = 502;
    res.end();
  });
  req.pipe(upstream);
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Local delivery lab: 256 kbit/s on localhost:${port}`),
);
