import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import InviteUserModal from "./InviteUserModal";

/**
 * H43: owners could not invite people after onboarding. The modal opens from the Users page
 * (gated on users.create) and renders the invitee form; roles load after mount.
 */
describe("InviteUserModal", () => {
  it("renders the invite form with email, name and role fields when open", () => {
    const html = renderToStaticMarkup(<InviteUserModal show onHide={() => {}} />);
    expect(html).toContain("Invite user");
    expect(html).toContain('name="email"');
    expect(html).toContain('name="fullName"');
    expect(html).toContain('name="roleId"');
    expect(html).toContain("Send invitation");
  });

  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(<InviteUserModal show={false} onHide={() => {}} />);
    expect(html).toBe("");
  });
});
