import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import CustomButton from "../../../components/ui/Button/Button";
import CommonModal from "../../../components/ui/Modal/CommonModal";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import {
  invitationService,
  type AssignableRole,
  type SentInvitation,
} from "../../../services/invitationService";

interface InviteUserModalProps {
  show: boolean;
  onHide: () => void;
}

const EMPTY_FORM = { email: "", fullName: "", roleId: "" };

const messageOf = (err: unknown, fallback: string) => {
  const data = (err as { response?: { data?: { message?: unknown } } })?.response?.data;
  return typeof data?.message === "string" ? data.message : fallback;
};

/**
 * Invite a colleague after onboarding (H43). Same flow as the onboarding Users step: the
 * invitee chooses their own password from the emailed link. When email is not configured the
 * link is shown here so the owner can pass it on.
 */
const InviteUserModal: React.FC<InviteUserModalProps> = ({ show, onHide }) => {
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentInvitation | null>(null);

  useEffect(() => {
    if (!show || roles.length > 0) return;
    invitationService
      .assignableRoles()
      .then((list) => {
        setRoles(list);
        const preferred = list.find((r) => r.code === "ACCOUNTS") ?? list[0];
        if (preferred) setForm((f) => (f.roleId ? f : { ...f, roleId: String(preferred.id) }));
      })
      .catch((err) => setRolesError(messageOf(err, "Could not load roles")));
  }, [show, roles.length]);

  const reset = () => {
    setForm((f) => ({ ...EMPTY_FORM, roleId: f.roleId }));
    setError(null);
    setSent(null);
  };

  const close = () => {
    reset();
    onHide();
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!form.email.trim()) {
      setError("Enter the email address to invite");
      return;
    }
    if (!form.roleId) {
      setError("Choose a role");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await invitationService.create({
        email: form.email.trim(),
        fullName: form.fullName.trim() || undefined,
        roleId: Number(form.roleId),
      });
      setSent(res);
      if (res.emailed) toast.success(`Invitation emailed to ${res.email}`);
    } catch (err) {
      setError(messageOf(err, "Could not send the invitation"));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  };

  const footer = sent ? (
    <div className="flex items-center justify-end gap-2 w-full">
      <CustomButton text="Invite another" onClick={reset} />
      <CustomButton text="Done" onClick={close} />
    </div>
  ) : (
    <div className="flex items-center justify-end gap-2 w-full">
      <CustomButton text="Cancel" onClick={close} />
      <CustomButton text={busy ? "Sending…" : "Send invitation"} onClick={submit} disabled={busy} />
    </div>
  );

  return (
    <CommonModal show={show} onHide={close} title="Invite user" footer={footer}>
      {sent ? (
        <div className="space-y-3 text-sm">
          <p className="text-ink">
            <span className="font-semibold">{sent.email}</span>{" "}
            {sent.emailed
              ? "has been invited by email."
              : "is invited. Email is not configured on this server, so send them this link:"}
          </p>
          {!sent.emailed && sent.acceptUrl && (
            <div className="space-y-2">
              <div className="break-all rounded-md border border-line-soft bg-card-2 p-3 font-mono text-[11px] text-ink-muted">
                {sent.acceptUrl}
              </div>
              <CustomButton text="Copy link" onClick={() => copyLink(sent.acceptUrl!)} />
            </div>
          )}
        </div>
      ) : (
        <form id="inviteUserForm" onSubmit={submit} className="space-y-4" noValidate>
          <TextInput
            label="Email"
            name="email"
            type="email"
            value={form.email}
            placeholder="name@company.com"
            required
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <TextInput
            label="Full name"
            name="fullName"
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
          />
          <SelectInput
            label="Role"
            name="roleId"
            value={form.roleId}
            required
            options={[
              { value: "", label: rolesError ?? (roles.length ? "-- Select role --" : "Loading…") },
              ...roles.map((r) => ({ value: String(r.id), label: r.name })),
            ]}
            onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
          />
          {error && (
            <p role="alert" className="text-sm text-[color:var(--color-danger)]">
              {error}
            </p>
          )}
        </form>
      )}
    </CommonModal>
  );
};

export default InviteUserModal;
