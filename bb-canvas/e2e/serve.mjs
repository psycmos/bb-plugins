// A static file server with no dependency of its own — Playwright's
// `webServer` needs nothing fancier than "hand back the file at this path",
// and reaching for a package here would mean another registry fetch just to
// run the e2e suite offline.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Another worktree's run may hold the default port; E2E_PORT picks another.
const port = Number(process.env.E2E_PORT ?? 4173);

const root = fileURLToPath(new URL(".", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  const url = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
  // The query (`?width=370`) is for the page, not part of the file name.
  const path = url.split("?")[0];
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`e2e fixture server on http://127.0.0.1:${port}`);
});
