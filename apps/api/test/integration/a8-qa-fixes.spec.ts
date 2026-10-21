import { describe, expect, it } from "vitest";
import { api, authed } from "../helpers/app";

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

describe("duplicate masters under concurrent create (R2H-B10)", () => {
  it("creates one department when two identical creates race", async () => {
    const { auth } = await authed("demo.owner");
    const name = `R2H Race Dept ${uniq()}`;
    const [a, b] = await Promise.all([
      (await api()).post("/api/departments").set(auth).send({ name }),
      (await api()).post("/api/departments").set(auth).send({ name }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(JSON.stringify(loser.body)).not.toMatch(/Prisma|prisma|stack|\.ts:/);
  });

  it("answers 409 instead of 500 when two identical customer creates race", async () => {
    const { auth } = await authed("demo.owner");
    const code = `R2HC${uniq()}`.slice(0, 20);
    const body = { customerCode: code, firmName: `Race Firm ${code}`, displayName: `Race ${code}` };
    const [a, b] = await Promise.all([
      (await api()).post("/api/customers").set(auth).send(body),
      (await api()).post("/api/customers").set(auth).send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(JSON.stringify(loser.body)).not.toMatch(/Prisma|prisma|stack|\.ts:/);
  });

  it("answers 409 for a sequential duplicate customer code", async () => {
    const { auth } = await authed("demo.owner");
    const code = `R2HS${uniq()}`.slice(0, 20);
    const body = { customerCode: code, firmName: `Seq Firm ${code}`, displayName: `Seq ${code}` };
    const first = await (await api()).post("/api/customers").set(auth).send(body);
    expect(first.status).toBe(201);
    const second = await (await api()).post("/api/customers").set(auth).send(body);
    expect(second.status).toBe(409);
  });
});
