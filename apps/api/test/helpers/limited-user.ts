import { api } from "./app";
import { getPrisma } from "./db";
import { asDemoTenant, demoCompany } from "../factories";
import { hashPassword } from "../../src/utils/hashPassword";

/**
 * A demo-tenant user whose role holds exactly `keys` (permission keys such as
 * "production-wastages.view"), logged in. `tag` must be unique per call: it names the role and
 * the user.
 */
export const limitedUser = async (tag: string, keys: string[]) => {
  const prisma = await getPrisma();
  const username = `lim.${tag}`.toLowerCase();
  await asDemoTenant(async () => {
    const company = await demoCompany();
    const role = await prisma.role.create({
      data: { companyId: company.id, code: `LIM-${tag}`.toUpperCase(), name: `Limited ${tag}` },
    });
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } } });
    if (perms.length !== keys.length) {
      throw new Error(`unknown permission key in ${JSON.stringify(keys)}`);
    }
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    await prisma.user.create({
      data: {
        companyId: company.id,
        username,
        fullName: `Limited ${tag}`,
        email: `${username}@test.shiftline.local`,
        passwordHash: await hashPassword("Test@12345678"),
        roleId: role.id,
        status: "active",
      },
    });
  });
  const login = await (
    await api()
  )
    .post("/api/auth/login")
    .send({ email: username, password: "Test@12345678" });
  if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
  return { auth: { Authorization: `Bearer ${login.body.data.accessToken as string}` } };
};
