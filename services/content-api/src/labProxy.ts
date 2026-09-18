// Local-only throttling harness. Never deploy this process.
import { createServer, request } from "node:http";
import { Transform } from "node:stream";
let sent = 0;
const server = createServer((req, res) => {
  if (req.url === "/stats") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ bytesSent: sent }));
    return;
  }
  if (req.url === "/reset") {
    sent = 0;
    res.end("ok");
    return;
  }
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: 4400,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: "localhost:4400" },
    },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      const throttle = new Transform({
        transform(chunk, _encoding, callback) {
          sent += chunk.length;
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
server.listen(4401, "127.0.0.1", () =>
  console.log("Local delivery lab: 256 kbit/s on localhost:4401"),
);
