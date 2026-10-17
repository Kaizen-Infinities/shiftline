import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());

vi.mock("../api/apiClient", () => ({
  default: { post },
  apiClient: { post },
}));

import authService from "./authService";

describe("authService password reset calls", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: { message: "ok" } });
  });

  it("posts the email to password-reset-request", async () => {
    await authService.requestPasswordReset("a@b.co");
    expect(post).toHaveBeenCalledWith("/auth/password-reset-request", { email: "a@b.co" });
  });

  it("posts token and newPassword to password-reset", async () => {
    await authService.resetPassword("abc123", "Abcdef12");
    expect(post).toHaveBeenCalledWith("/auth/password-reset", {
      token: "abc123",
      newPassword: "Abcdef12",
    });
  });
});
