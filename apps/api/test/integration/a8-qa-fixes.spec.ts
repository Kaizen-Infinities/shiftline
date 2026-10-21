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

describe("markup in names (R2H-B12)", () => {
  it("refuses angle brackets in a department name with a field-level message", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/departments")
      .set(auth)
      .send({ name: `<img src=x onerror=alert(1)> ${uniq()}` });
    expect(res.status).toBe(400);
    const err = res.body.errors?.find((e: { path: string }) => e.path === "body.name");
    expect(err?.message).toMatch(/Angle brackets/);
  });

  it("refuses a script tag in a customer firm name", async () => {
    const { auth } = await authed("demo.owner");
    const code = `R2HX${uniq()}`.slice(0, 20);
    const res = await (
      await api()
    )
      .post("/api/customers")
      .set(auth)
      .send({ customerCode: code, firmName: "<script>alert(1)</script>", displayName: code });
    expect(res.status).toBe(400);
    expect(res.body.errors?.some((e: { path: string }) => e.path === "body.firmName")).toBe(true);
  });

  it("still accepts ordinary punctuation in a department name", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/departments")
      .set(auth)
      .send({ name: `M/s Sharma & Sons's Dept ${uniq()}` });
    expect(res.status).toBe(201);
  });
});

describe("request bodies (R2H-B19, R2H-B21)", () => {
  it("refuses a 2 MB JSON body on an ordinary route with 413", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/departments")
      .set(auth)
      .send({ name: `Big ${uniq()}`, description: "x".repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it("still accepts a 2 MB JSON body on the mobile sync route", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/mobile/sync/push")
      .set(auth)
      .send({ padding: "x".repeat(2 * 1024 * 1024) });
    expect(res.status).not.toBe(413);
  });

  it("refuses a form-encoded post with 415 and creates nothing", async () => {
    const { auth } = await authed("demo.owner");
    const name = `Form Dept ${uniq()}`;
    const res = await (
      await api()
    )
      .post("/api/departments")
      .set(auth)
      .type("form")
      .send(`name=${encodeURIComponent(name)}`);
    expect(res.status).toBe(415);
    const list = await (await api()).get("/api/departments").query({ search: name }).set(auth);
    expect(list.body.data.some((d: { name: string }) => d.name === name)).toBe(false);
  });
});

describe("department and role edits (R2H-B22, R2H-B23)", () => {
  it("refuses an empty department name on PATCH with a field-level 400, not 409", async () => {
    const { auth } = await authed("demo.owner");
    const created = await (
      await api()
    )
      .post("/api/departments")
      .set(auth)
      .send({ name: `Patch Dept ${uniq()}` });
    expect(created.status).toBe(201);
    const res = await (
      await api()
    )
      .patch(`/api/departments/${created.body.data.id}`)
      .set(auth)
      .send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body.errors?.some((e: { path: string }) => e.path === "body.name")).toBe(true);
  });

  it("lets a description-only PATCH through even when other departments exist", async () => {
    const { auth } = await authed("demo.owner");
    const created = await (
      await api()
    )
      .post("/api/departments")
      .set(auth)
      .send({ name: `Desc Dept ${uniq()}` });
    expect(created.status).toBe(201);
    const res = await (
      await api()
    )
      .patch(`/api/departments/${created.body.data.id}`)
      .set(auth)
      .send({ description: "only the description changed" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(created.body.data.name);
  });

  it("refuses a 1000-character role name", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/roles")
      .set(auth)
      .send({ code: `R2H${uniq()}`.slice(0, 20), name: "R".repeat(1000) });
    expect(res.status).toBe(400);
    expect(res.body.errors?.some((e: { path: string }) => e.path === "body.name")).toBe(true);
  });
});
