import React, { useState } from "react";
import { onboardingService } from "../../../services/onboardingService";
import type { InvitationResult, OnboardingState, OnboardingStepKey } from "../types";
import { Actions, ErrorBox, Field, PrimaryButton, SecondaryButton, StepHeader } from "./fields";
import { apiMessage, inputClass } from "./utils";

interface Props {
  state: OnboardingState;
  onSaved: (next: OnboardingStepKey) => Promise<void>;
  onBack: () => void;
}

interface Row {
  email: string;
  fullName: string;
  roleCode: string;
}

const UsersStep: React.FC<Props> = ({ state, onSaved, onBack }) => {
  const roles = state.roles
    .filter((r) => r.code !== "OWNER")
    .concat(state.roles.filter((r) => r.code === "OWNER"));
  const defaultRole = roles.find((r) => r.code === "ACCOUNTS")?.code ?? roles[0]?.code ?? "";
  const [rows, setRows] = useState<Row[]>([{ email: "", fullName: "", roleCode: defaultRole }]);
  const [results, setResults] = useState<InvitationResult[] | null>(null);
  const [nextStep, setNextStep] = useState<OnboardingStepKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (idx: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const send = async (invitations: Row[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await onboardingService.saveUsers({
        invitations: invitations.map((r) => ({
          email: r.email.trim(),
          fullName: r.fullName.trim() || null,
          roleCode: r.roleCode,
        })),
      });
      if (invitations.length === 0) {
        await onSaved(res.step);
        return;
      }
      setResults(res.results);
      setNextStep(res.step);
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await send(rows.filter((r) => r.email.trim()));
  };

  return (
    <form onSubmit={submit} noValidate>
      <StepHeader
        title="Invite your team"
        subtitle="Each person gets an email link to choose their own password. Roles can be changed later under Users."
      />

      {(state.users.length > 0 || state.invitations.length > 0) && (
        <div className="mb-5 rounded-xl border border-line-soft bg-card-2/60 p-4 text-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            Already on board
          </div>
          <ul className="mt-2 space-y-1">
            {state.users.map((u) => (
              <li key={u.userId} className="flex justify-between gap-3 text-ink">
                <span>
                  {u.fullName} <span className="text-ink-muted">· {u.email}</span>
                </span>
                <span className="text-ink-muted">{u.roleName ?? "—"}</span>
              </li>
            ))}
            {state.invitations.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 text-ink-muted">
                <span>
                  {i.fullName ?? i.email} <span>· invited</span>
                </span>
                <span>{i.roleName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {results ? (
        <div className="rounded-xl border border-line-soft bg-card-2/60 p-4 text-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-ink-muted">
            Invitations
          </div>
          <ul className="mt-2 space-y-2">
            {results.map((r) => (
              <li key={r.email} className="text-ink">
                <span className="font-semibold">{r.email}</span>{" "}
                {r.status === "invited" && (
                  <span className="text-emerald-500">
                    {r.emailed ? "invited by email" : "invited (email not configured)"}
                  </span>
                )}
                {r.status === "exists" && (
                  <span className="text-amber-500">already has an account</span>
                )}
                {r.status === "error" && <span className="text-red-500">{r.message}</span>}
                {r.acceptUrl && (
                  <div className="mt-1 break-all font-mono text-[11px] text-ink-muted">
                    {r.acceptUrl}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r, idx) => (
            <div key={idx} className="grid gap-3 md:grid-cols-7">
              <Field label="Email" className="md:col-span-3">
                <input
                  type="email"
                  className={inputClass}
                  value={r.email}
                  onChange={(e) => update(idx, { email: e.target.value })}
                  placeholder="name@company.com"
                  aria-label={`Invitee ${idx + 1} email`}
                />
              </Field>
              <Field label="Name" className="md:col-span-2">
                <input
                  className={inputClass}
                  value={r.fullName}
                  onChange={(e) => update(idx, { fullName: e.target.value })}
                />
              </Field>
              <Field label="Role" className="md:col-span-2">
                <select
                  className={inputClass}
                  value={r.roleCode}
                  onChange={(e) => update(idx, { roleCode: e.target.value })}
                >
                  {roles.map((role) => (
                    <option key={role.code} value={role.code}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ))}
          <SecondaryButton
            onClick={() =>
              setRows((rs) => [...rs, { email: "", fullName: "", roleCode: defaultRole }])
            }
          >
            + Add another
          </SecondaryButton>
        </div>
      )}

      <ErrorBox message={error} />
      <Actions>
        <div className="flex gap-2">
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          {!results && (
            <SecondaryButton onClick={() => send([])} disabled={busy}>
              Skip for now
            </SecondaryButton>
          )}
        </div>
        {results ? (
          <PrimaryButton type="button" onClick={() => nextStep && onSaved(nextStep)}>
            Continue
          </PrimaryButton>
        ) : (
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send invitations"}
          </PrimaryButton>
        )}
      </Actions>
    </form>
  );
};

export default UsersStep;
