import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { usePermission } from "../../../hooks/usePermission";
import { fetchCompany } from "../../../features/company/companySlice";
import { logoutUser } from "../../../features/auth/authSlice";
import CommonLoader from "../../../components/ui/Loader/CommonLoader";
import { BrandLockup } from "../../../components/brand/BrandMark";
import { onboardingService } from "../../../services/onboardingService";
import type { OnboardingState, OnboardingStepKey } from "../types";
import { ErrorBox, SecondaryButton } from "../steps/fields";
import { apiMessage } from "../steps/utils";
import CompanyStep from "../steps/CompanyStep";
import GstStep from "../steps/GstStep";
import FinancialYearStep from "../steps/FinancialYearStep";
import BankStep from "../steps/BankStep";
import UsersStep from "../steps/UsersStep";
import ReviewStep from "../steps/ReviewStep";

const ORDER: OnboardingStepKey[] = ["company", "gst", "financial-year", "bank", "users", "review"];

/**
 * First-run wizard for a newly provisioned tenant (P1-00). ProtectedRoute sends
 * every signed-in member here until the company is marked onboarded; only
 * holders of company-settings.edit (the owner) can fill it in.
 */
const OnboardingWizard: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { can } = usePermission();
  const user = useAppSelector((s) => s.auth.user);
  const canEdit = can("company-settings.edit");

  const [state, setState] = useState<OnboardingState | null>(null);
  const [active, setActive] = useState<OnboardingStepKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await onboardingService.getState();
    setState(s);
    return s;
  }, []);

  const finish = useCallback(async () => {
    await dispatch(fetchCompany());
    navigate("/dashboard", { replace: true });
  }, [dispatch, navigate]);

  useEffect(() => {
    load()
      .then((s) => {
        if (s.isOnboarded) return finish();
        setActive((a) => a ?? s.step ?? "review");
      })
      .catch((err) => setError(apiMessage(err)));
  }, [load, finish]);

  const onSaved = async (next: OnboardingStepKey) => {
    await load();
    setActive(next);
    window.scrollTo({ top: 0 });
  };

  const goto = (step: OnboardingStepKey) => {
    setActive(step);
    window.scrollTo({ top: 0 });
  };

  const back = () => {
    const idx = ORDER.indexOf(active ?? "company");
    if (idx > 0) goto(ORDER[idx - 1]);
  };

  const signOut = async () => {
    await dispatch(logoutUser());
    navigate("/login", { replace: true });
  };

  if (error && !state) {
    return (
      <div className="min-h-screen bg-page px-4 py-16 text-ink">
        <div className="sl-tile mx-auto max-w-md !rounded-[24px] p-8">
          <h1 className="sl-h2 !text-xl">Could not load onboarding</h1>
          <ErrorBox message={error} />
          <div className="mt-6 flex gap-2">
            <SecondaryButton onClick={() => window.location.reload()}>Retry</SecondaryButton>
            <SecondaryButton onClick={signOut}>Sign out</SecondaryButton>
          </div>
        </div>
      </div>
    );
  }
  if (!state || !active) return <CommonLoader text="Loading your workspace…" />;

  const currentIdx = ORDER.indexOf(state.step ?? "review");

  if (!canEdit) {
    const owners = state.users.filter((u) => u.roleCode === "OWNER");
    return (
      <div className="min-h-screen bg-page px-4 py-16 text-ink">
        <div className="sl-tile mx-auto max-w-md !rounded-[24px] p-8">
          <h1 className="sl-h2 !text-xl">{state.company.companyName} is being set up</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {owners.length ? owners.map((o) => o.fullName).join(", ") : "Your administrator"} is
            completing the company setup. You will have access as soon as it is finished — no action
            is needed from you.
          </p>
          <ul className="mt-4 space-y-1 text-sm">
            {state.steps.map((s) => (
              <li key={s.key} className={s.done ? "text-accent" : "text-ink-muted"}>
                {s.done ? "✓" : "○"} {s.label}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex gap-2">
            <SecondaryButton onClick={() => load()}>Refresh</SecondaryButton>
            <SecondaryButton onClick={signOut}>Sign out</SecondaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-6 sm:px-6">
        <BrandLockup size={40} />
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <span className="hidden sm:inline">{user?.fullName}</span>
          <SecondaryButton onClick={signOut}>Sign out</SecondaryButton>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
        <p className="sl-welcome">
          Let's set up <strong>{state.company.companyName}</strong>
        </p>
        <p className="sl-muted mt-2 text-sm">
          Six short steps. Everything can be changed later from Settings.
        </p>
      </div>

      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 md:grid-cols-[260px_1fr] md:gap-8">
        <nav aria-label="Setup steps">
          <div className="sl-section-label mb-2">Shiftline setup</div>
          <ol className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
            {state.steps.map((s, idx) => {
              const reachable = idx <= currentIdx;
              const isActive = s.key === active;
              return (
                <li key={s.key} className="shrink-0">
                  <button
                    type="button"
                    disabled={!reachable}
                    onClick={() => goto(s.key)}
                    aria-current={isActive ? "step" : undefined}
                    className={`sl-nav-item w-full text-left text-sm disabled:cursor-not-allowed ${
                      isActive ? "is-active" : reachable ? "" : "opacity-55"
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        isActive
                          ? "bg-primary text-[color:var(--color-white)]"
                          : s.done
                            ? "bg-[color:var(--color-cta)] text-[color:var(--color-cta-ink)]"
                            : "bg-card-2 text-ink-subtle"
                      }`}
                    >
                      {s.done && !isActive ? "✓" : idx + 1}
                    </span>
                    <span className="whitespace-nowrap">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="sl-tile min-w-0 !rounded-[24px] p-5 sm:p-8" data-step={active}>
          {active === "company" && <CompanyStep state={state} onSaved={onSaved} />}
          {active === "gst" && <GstStep state={state} onSaved={onSaved} onBack={back} />}
          {active === "financial-year" && (
            <FinancialYearStep state={state} onSaved={onSaved} onBack={back} />
          )}
          {active === "bank" && <BankStep state={state} onSaved={onSaved} onBack={back} />}
          {active === "users" && <UsersStep state={state} onSaved={onSaved} onBack={back} />}
          {active === "review" && <ReviewStep state={state} onEdit={goto} onComplete={finish} />}
        </main>
      </div>
    </div>
  );
};

export default OnboardingWizard;
