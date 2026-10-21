import "./lib/bigint-json";
import express, { Application } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import rateLimit from "express-rate-limit";
import path from "path";

import apiRoutes from "./routes/index.routes";
import { logger } from "./lib/logger";
import { redactUrl } from "./lib/redact-url";
import { requestContextMiddleware } from "./lib/request-context";
import healthRoutes from "./routes/health.routes";

import { errorMiddleware } from "./middleware/error.middleware";
import { env, isProduction, isTest } from "./config/env";

const app: Application = express();

/** Trust reverse proxy in production*/
if (isProduction) {
  app.set("trust proxy", 1);
}

/** CORS Configuration*/
// Uploads are public (referenced from <img> tags, no auth headers): serve images only, never execute or sniff.
const UPLOAD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
app.use("/uploads", (req, res, next) => {
  if (!UPLOAD_EXTENSIONS.has(path.extname(req.path).toLowerCase())) {
    return res.sendStatus(404);
  }
  next();
});
app.use(
  "/uploads",
  express.static(path.join(__dirname, "../uploads"), {
    dotfiles: "deny",
    index: false,
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'");
      res.setHeader("Content-Disposition", "inline");
    },
  })
);

// Build CORS origin list from environment variables
export const allowedOrigins = [
  env.FRONTEND_URL,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];

// Add production frontend URLs if different from defaults
if (isProduction && env.FRONTEND_URL !== "http://localhost:5173") {
  allowedOrigins.push(env.FRONTEND_URL);
}

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "X-Company-Id",
      "X-Device-Id",
      "X-App-Version",
      "X-Device-Platform",
      "X-Device-Model",
      "X-Device-Time",
    ],
    exposedHeaders: ["Content-Disposition", "X-Request-Id"],
  })
);

/** Security headers (SEC-06). API responses are JSON; uploads are served to the SPA origin. */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Same policy as CSP frame-ancestors 'none' (helmet defaults to SAMEORIGIN otherwise).
    frameguard: { action: "deny" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);

/** Rate limits: a global ceiling per IP, and a tight one on credential endpoints. */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.GLOBAL_RATE_LIMIT_MAX,
  skip: () => isTest,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down.", errors: [] },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  skip: () => isTest,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      success: false,
      message: "Too many login attempts. Please wait a few minutes and try again.",
      errors: [],
      code: "RATE_LIMITED",
    });
  },
});
// Request id first so every later log line and error response carries it.
app.use(requestContextMiddleware);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => String(req.headers["x-request-id"] ?? ""),
    autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
    serializers: {
      req: (req) => ({ method: req.method, url: redactUrl(req.url) }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);
app.use("/api", globalLimiter);
app.use(
  [
    "/api/auth/login",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    // The real reset routes (API-02); the two paths above do not exist.
    "/api/auth/password-reset-request",
    "/api/auth/password-reset",
    "/api/auth/register",
    // A password check like login, so it gets login's brute-force limit.
    "/api/shift-execution/supervisor-override",
  ],
  authLimiter
);

/** Request Parsers*/
app.use(cookieParser());

app.use(
  express.json({
    limit: "10mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

/** Application Routes*/
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Shiftline API",
    version: "1.0.0",
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// Liveness and readiness for compose, CI and the status page (no auth, no rate limit).
app.use(healthRoutes);
app.use("/api", apiRoutes);

/** Route Not Found Handler*/
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

/** Global Error Handler*/
app.use(errorMiddleware);

export default app;
