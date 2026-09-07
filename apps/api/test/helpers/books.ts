import { api, authed } from "./app";

/**
 * Period control is company state (freeze date, closed periods) that survives between test
 * files sharing a worker database. Specs that move it call this before and after so the order
 * in which vitest schedules files never decides a result.
 */
export const resetPeriodControl = async () => {
  const owner = await authed("demo.owner");
  const client = await api();
  await client
    .put("/api/accounts/period-control")
    .set(owner.auth)
    .send({ booksFrozenUpTo: null, allowBack: true });
  const control = await client.get("/api/accounts/period-control").set(owner.auth);
  const periods = (control.body?.data?.periods ?? []) as { id: number; isClosed: boolean }[];
  for (const p of periods.filter((x) => x.isClosed)) {
    await client.post(`/api/accounts/periods/${p.id}/reopen`).set(owner.auth);
  }
};
