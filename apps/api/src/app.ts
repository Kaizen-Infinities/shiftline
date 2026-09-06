import express, { Application } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";

import apiRoutes from "./routes/index.routes";

import { errorMiddleware } from "./middleware/error.middleware";
import { env, isProduction, isTest } from "./config/env";

const app: Application = express();

/** Trust reverse proxy in production*/
if (isProduction) {
  app.set("trust proxy", 1);
}

/** CORS Configuration*/
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

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
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"],
  })
);

/** Security headers (SEC-06). API responses are JSON; uploads are served to the SPA origin. */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
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
  limit: 1200,
  skip: () => isTest,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down.", errors: [] },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skip: () => isTest,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
    errors: [],
  },
});
app.use("/api", globalLimiter);
app.use(
  [
    "/api/auth/login",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/register",
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
/** Request Logger Middleware */
app.use((req, res, next) => {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
  next();
});

/** Application Routes*/
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Shiftline API",
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

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
