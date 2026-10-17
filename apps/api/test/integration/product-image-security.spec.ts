import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api } from "../helpers/app";
import { limitedUser } from "../helpers/limited-user";

/**
 * Product images: creating one needs product-images.edit (not view), and the public
 * /uploads path serves image extensions only.
 */
describe("product image permissions and uploads", () => {
  it("a user with only product-images.view gets 403 on POST /api/product-images", async () => {
    const viewer = await limitedUser(`pimg-${randomUUID().slice(0, 6)}`, ["product-images.view"]);
    const res = await (
      await api()
    )
      .post("/api/product-images")
      .set(viewer.auth)
      .field("name", "Test product image");
    expect(res.status).toBe(403);
  }, 60_000);

  it("a non-image path under /uploads is not served", async () => {
    const res = await (await api()).get("/uploads/anything.html");
    expect(res.status).toBe(404);
  });
});
