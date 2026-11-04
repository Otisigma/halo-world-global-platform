import cors from "cors";

const publicAudioRoutes = new Set([
  "/api/drive-catalog/audio", "/api/song-catalog/audio", "/api/radio/audio",
  "/api/mixes/audio", "/api/stem-vault/audio",
]);
const defaultOrigins = [
  "http://localhost:3000", "http://127.0.0.1:3000",
  "https://halo-world-global-platform.netlify.app",
  "https://halomusicworld.com", "https://admin.halomusicworld.com",
];

export function createApiCors(extraOrigins = "") {
  const origins = new Set(defaultOrigins);
  for (const value of extraOrigins.split(",").map(value => value.trim()).filter(Boolean)) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) {
      throw new Error("CORS_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or trailing slashes");
    }
    origins.add(value);
  }
  const middleware = cors({
    origin: (origin, callback) => callback(null, Boolean(origin && origins.has(origin))),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Range"],
    exposedHeaders: ["Accept-Ranges", "Content-Length", "Content-Range", "Content-Type"],
  });
  return (req, res, next) => {
    // Audio handlers retain their existing public/private CORS and rights policy.
    if (publicAudioRoutes.has(req.path)) return next();
    const origin = req.get("Origin");
    res.vary("Origin");
    if (origin && !origins.has(origin)) {
      return res.status(403).json({ message: "Request origin is not allowed" });
    }
    return middleware(req, res, next);
  };
}
