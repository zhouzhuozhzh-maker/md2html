export default function handler(_request, response) {
  response.status(200).json({
    ok: true,
    runtime: "vercel-functions",
    storage: process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "missing-blob-token"
  });
}
