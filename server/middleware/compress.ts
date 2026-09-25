import { onResponse } from "nitro/h3";

// Nitro only pre-compresses public assets; this covers SSR HTML and server-function JSON.
export default onResponse((response, event) => {
  const type = response.headers.get("content-type") ?? "";
  if (
    !response.body ||
    response.headers.has("content-encoding") ||
    !/^(text\/|application\/(json|javascript|xml|ld\+json))/.test(type)
  )
    return;
  const accept = event.req.headers.get("accept-encoding") ?? "";
  for (const format of ["zstd", "gzip"] as const) {
    if (!accept.includes(format)) continue;
    let stream: CompressionStream;
    try {
      stream = new CompressionStream(format as CompressionFormat); // Node has no zstd here; Bun does.
    } catch {
      continue;
    }
    const headers = new Headers(response.headers);
    headers.set("content-encoding", format);
    headers.delete("content-length");
    headers.append("vary", "Accept-Encoding");
    return new Response(response.body.pipeThrough(stream), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
});
