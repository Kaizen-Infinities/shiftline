import { api } from "./app";
import { seedTenant } from "../../prisma/seed-lib";

const PASSWORD = "Test@12345678";

/**
 * A second, fully provisioned tenant (same shape as the demo tenant) for cross-tenant tests.
 * `slug` must be unique per spec file: it prefixes usernames and the company code. Returns the
 * foreign company id and a bearer header for its owner.
 */
export const foreignTenant = async (slug: string) => {
  const company = await seedTenant({
    companyCode: `XT-${slug.toUpperCase()}`,
    companyName: `Foreign ${slug} Industries`,
    slug,
    globalPrefix: slug.toUpperCase(),
    password: PASSWORD,
  });
  const res = await (
    await api()
  )
    .post("/api/auth/login")
    .send({ email: `${slug}.owner`, password: PASSWORD });
  if (res.status !== 200) throw new Error(`foreign login failed: ${res.status}`);
  return {
    companyId: company.id,
    auth: { Authorization: `Bearer ${res.body.data.accessToken as string}` },
  };
};
