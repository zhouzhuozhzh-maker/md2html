function isNetlifyResponse(value) {
  return value && typeof value === "object" && !("status" in value && "json" in value);
}

export default function handler(_request, response) {
  const payload = {
    ok: true,
    runtime: process.env.NETLIFY ? "netlify-functions" : "vercel-functions",
    storage: process.env.DATABASE_URL ? "postgres" : process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "missing-storage"
  };

  if (isNetlifyResponse(response)) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  response.status(200).json(payload);
}
