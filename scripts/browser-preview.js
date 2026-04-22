const fs = require("fs");
const http = require("http");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".icns": "image/icns",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".yml": "text/yaml; charset=utf-8"
};

function resolveRequestPath(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  return path.join(rootDir, normalized);
}

function respondWithFile(response, filePath) {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

  if (requestUrl.pathname === "/") {
    response.writeHead(302, {
      Location: "/src/electron/renderer/index.html?browser-preview=ready"
    });
    response.end();
    return;
  }

  respondWithFile(response, resolveRequestPath(requestUrl.pathname));
});

server.listen(port, host, () => {
  const baseUrl = `http://${host}:${port}`;
  console.log(`Browser launcher preview running at ${baseUrl}`);
  console.log(`Default preview: ${baseUrl}/src/electron/renderer/index.html?browser-preview=ready`);
  console.log(`Missing client state: ${baseUrl}/src/electron/renderer/index.html?browser-preview=missing`);
  console.log(`Patching state: ${baseUrl}/src/electron/renderer/index.html?browser-preview=patching`);
  console.log(`Update state: ${baseUrl}/src/electron/renderer/index.html?browser-preview=update`);
});
