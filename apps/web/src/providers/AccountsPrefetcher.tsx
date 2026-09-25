import { useEffect } from "react";
import { useAppSelector } from "../hooks/reduxHooks";
import { prefetchAllAccountsCaches } from "./accountsPrefetchList";

/**
 * AccountsPrefetcher — one-shot cache warmer for every accounts list/report page.
 *
 * Fires ONCE after login. Uses the shared prefetchAllAccountsCaches helper so
 * it stays in sync with AccountsRealtimeSync (which uses the same helper on
 * every write event).
 */
const AccountsPrefetcher: React.FC = () => {
  const { data: company } = useAppSelector((state) => state.company);
  const user = useAppSelector((state) => state.auth.user);
  const companyId = company?.id;
  const userId = user?.userId;
  const isSuperAdmin = user?.isSuperAdmin;

  useEffect(() => {
    // Platform admins have no tenant (P1-02): the accounts caches are not theirs to warm.
    // Wait for the company too: auth and company resolve separately on login,
    // otherwise the hot accounts requests fire twice (before and after companyId).
    if (!userId || isSuperAdmin || !companyId) return;
    // Tiny delay so the current page's own fetch grabs its Neon pool connection
    // first (13-conn limit shared with the prefetch burst).
    const timer = window.setTimeout(() => {
      prefetchAllAccountsCaches(companyId);
    }, 150);
    return () => clearTimeout(timer);
  }, [userId, isSuperAdmin, companyId]);

  return null;
};

export default AccountsPrefetcher;
