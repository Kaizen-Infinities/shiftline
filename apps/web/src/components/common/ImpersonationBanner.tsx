import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import apiClient from "../../api/apiClient";
import { refreshAccessToken } from "../../api/refresh";
import { getCurrentUser, setAccessToken } from "../../features/auth/authSlice";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";

/**
 * Shown while a platform admin acts as a tenant user (P1-02). Names the user, counts down the
 * thirty-minute window and hands the admin back their own session on Stop.
 */
const remaining = (iso: string) =>
  Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const ImpersonationBanner: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { impersonation, user } = useAppSelector((s) => s.auth);
  const [left, setLeft] = useState(impersonation ? remaining(impersonation.expiresAt) : 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!impersonation) return;
    const tick = () => setLeft(remaining(impersonation.expiresAt));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [impersonation]);

  if (!impersonation) return null;

  const stop = async () => {
    setBusy(true);
    try {
      await apiClient.post("/auth/impersonation/end").catch(() => undefined);
      const admin = await refreshAccessToken();
      if (!admin) throw new Error("Could not restore the admin session");
      dispatch(setAccessToken(admin));
      await dispatch(getCurrentUser());
      toast.info("Back to your admin session");
      navigate("/platform");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-amber-950"
      role="status"
      data-testid="impersonation-banner"
    >
      <span>
        Acting as <b>{user?.fullName ?? user?.username}</b> for support ({impersonation.reason}).
        Every change is recorded against you. Ends in {mmss(left)}.
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        className="rounded bg-amber-950 px-3 py-1 text-amber-50 hover:bg-black disabled:opacity-50"
      >
        {busy ? "Stopping…" : "Stop impersonating"}
      </button>
    </div>
  );
};

export default ImpersonationBanner;
