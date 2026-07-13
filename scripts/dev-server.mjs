import { createReadStream, promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const preferredPort = Number(process.env.PORT || 8080);
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self' blob:",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"]
]);

function resolveRequestPath(requestUrl) {
  try {
    const url = new URL(requestUrl, "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    const normalizedRelativePath = relativePath.replaceAll("\\", "/");

    if (
      normalizedRelativePath !== "index.html" &&
      !normalizedRelativePath.startsWith("src/")
    ) {
      return null;
    }

    if (normalizedRelativePath.split("/").some((segment) => !segment || segment.startsWith("."))) {
      return null;
    }

    const requestedPath = path.resolve(root, normalizedRelativePath);
    const relativeToRoot = path.relative(root, requestedPath);

    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;

    return requestedPath;
  } catch {
    return null;
  }
}

async function serveFile(req, res) {
  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    res.writeHead(405, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  const filePath = resolveRequestPath(req.url);

  if (!filePath) {
    res.writeHead(403, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    const resolvedFile = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const extension = path.extname(resolvedFile);

    res.writeHead(200, {
      ...securityHeaders,
      "Content-Type": mimeTypes.get(extension) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(resolvedFile).pipe(res);
  } catch {
    res.writeHead(404, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function start(port) {
  const server = createServer(serveFile);

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      start(port + 1);
      return;
    }
    throw error;
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Distro IQ is running at http://127.0.0.1:${port}`);
  });
}

start(preferredPort);
