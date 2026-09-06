import request from "supertest";
import type { Express } from "express";

let cached: Express | undefined;

/** The Express app, imported lazily so env from test/setup.ts is in place first. */
export const getApp = async (): Promise<Express> => {
  if (!cached) {
    const mod = await import("../../src/app");
    cached = mod.default as Express;
  }
  return cached;
};

export const api = async () => request(await getApp());

export const SEED_PASSWORD = "Test@12345678";
export const ADMIN = { email: "admin@test.shiftline.local", password: "TestAdmin#2026!!" };

const tokenCache = new Map<string, string>();

/** Logs in a seeded user (demo.owner, demo.accounts, demo.stores, demo.production, demo.sales) and returns a bearer token. */
export const loginAs = async (username: string, password = SEED_PASSWORD): Promise<string> => {
  const key = `${username}:${password}`;
  const hit = tokenCache.get(key);
  if (hit) return hit;
  const res = await (await api()).post("/api/auth/login").send({ email: username, password });
  if (res.status !== 200)
    throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  const token = res.body.data.accessToken as string;
  tokenCache.set(key, token);
  return token;
};

export const authed = async (username = "demo.owner") => {
  const token = await loginAs(username);
  return { token, auth: { Authorization: `Bearer ${token}` } };
};
