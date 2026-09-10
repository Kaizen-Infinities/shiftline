import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "../../../providers/SocketProvider";
import { useAppSelector } from "../../../hooks/reduxHooks";
import { notificationsService, type AppNotification } from "../../../services/notificationsService";

const POLL_MS = 60_000;

/**
 * Latest notifications for the bell: loads on sign-in, prepends what arrives on
 * the personal socket room, and polls once a minute as a fallback.
 */
export const useNotifications = (limit = 15) => {
  const { socket } = useSocket();
  const user = useAppSelector((s) => s.auth.user);
  const isPlatformAdmin = !!user?.isSuperAdmin;
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!user || isPlatformAdmin) return;
    setLoading(true);
    try {
      const page = await notificationsService.list({ limit });
      if (!mounted.current) return;
      setItems(page.items);
      setUnreadCount(page.unreadCount);
    } catch {
      /* the bell is best-effort; the page keeps working without it */
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [user, isPlatformAdmin, limit]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    const onCreated = (n: AppNotification) => {
      setItems((xs) => [n, ...xs.filter((x) => x.id !== n.id)].slice(0, limit));
      setUnreadCount((c) => c + 1);
    };
    socket.on("notification:created", onCreated);
    return () => {
      socket.off("notification:created", onCreated);
    };
  }, [socket, limit]);

  const markRead = useCallback(
    async (id: string) => {
      const target = items.find((x) => x.id === id);
      if (!target || target.readAt) return;
      setItems((xs) =>
        xs.map((x) => (x.id === id ? { ...x, readAt: new Date().toISOString() } : x))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await notificationsService.markRead(id);
      } catch {
        void refresh();
      }
    },
    [items, refresh]
  );

  const markAllRead = useCallback(async () => {
    setItems((xs) => xs.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await notificationsService.markAllRead();
    } catch {
      void refresh();
    }
  }, [refresh]);

  return {
    items,
    unreadCount,
    loading,
    refresh,
    markRead,
    markAllRead,
    enabled: !!user && !isPlatformAdmin,
  };
};
