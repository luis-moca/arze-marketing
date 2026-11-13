// Cloudflare Pages "advanced mode" worker.
// Why it exists: Pages answers video requests with the whole file even when the browser
// asks for a piece (Range request). Safari and every iPhone refuse to play video like that.
// This worker answers those requests with just the requested piece (HTTP 206).
// Everything else is passed straight to the normal static files.

const VIDEO = /\.(mp4|webm|mov)$/i;
const TYPES = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isVideo = VIDEO.test(url.pathname);
    const range = request.headers.get("Range");

    if (!isVideo || !range || (request.method !== "GET" && request.method !== "HEAD")) {
      const res = await env.ASSETS.fetch(request);
      if (!isVideo) return res;
      const out = new Response(res.body, res);
      out.headers.set("Accept-Ranges", "bytes");
      return out;
    }

    // Fetch the whole file from the static assets, then return only the bytes asked for.
    const full = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
    if (!full.ok) return full;
    const buf = await full.arrayBuffer();
    const size = buf.byteLength;

    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start, end;
    if (m && m[1] === "" && m[2] !== "") { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; } // last N bytes
    else if (m && m[1] !== "") { start = parseInt(m[1], 10); end = m[2] === "" ? size - 1 : Math.min(parseInt(m[2], 10), size - 1); }
    if (!m || start === undefined || start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
    }

    const ext = url.pathname.split(".").pop().toLowerCase();
    return new Response(request.method === "HEAD" ? null : buf.slice(start, end + 1), {
      status: 206,
      headers: {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=604800",
        "ETag": full.headers.get("ETag") || "",
      },
    });
  },
};
