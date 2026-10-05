import React from "react";
import { useSocket } from "../providers/SocketProvider";
import { useAppDispatch } from "./reduxHooks";

/**
 * Realtime events are invalidation-only (F04): the payload is `{ id }` at most, never the
 * record. A handler must refetch through the REST API (`onAnyEvent`); only `deleted` may act
 * on the id, to drop a row that is already gone.
 */
interface SocketActions {
  deleted?: (id: any) => any;
}

export const useSocketSync = (
  moduleName: string,
  actions?: SocketActions,
  onAnyEvent?: () => void
) => {
  const dispatch = useAppDispatch();
  const { socket } = useSocket();

  const actionsRef = React.useRef(actions);
  const onAnyEventRef = React.useRef(onAnyEvent);

  React.useEffect(() => {
    actionsRef.current = actions;
    onAnyEventRef.current = onAnyEvent;
  }, [actions, onAnyEvent]);

  React.useEffect(() => {
    if (!socket) return;

    // Coalesce the `onAnyEvent` callback so 20 socket events in 30ms
    // trigger only ONE refetch instead of 20 (matches the debounce inside
    // useDetailCache / useListCache for consistency).
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const fireOnAny = () => {
      if (!onAnyEventRef.current) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        onAnyEventRef.current?.();
      }, 50);
    };

    const handleCreated = () => {
      fireOnAny();
    };

    const handleUpdated = () => {
      fireOnAny();
    };

    const handleDeleted = (payload: any) => {
      const id = payload?.id !== undefined ? payload.id : payload;
      if (actionsRef.current?.deleted) dispatch(actionsRef.current.deleted(id));
      fireOnAny();
    };

    socket.on(`${moduleName}:created`, handleCreated);
    socket.on(`${moduleName}:updated`, handleUpdated);
    socket.on(`${moduleName}:deleted`, handleDeleted);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      socket.off(`${moduleName}:created`, handleCreated);
      socket.off(`${moduleName}:updated`, handleUpdated);
      socket.off(`${moduleName}:deleted`, handleDeleted);
    };
    // We stringify the function references or omit them to prevent infinite loops if they aren't wrapped in useCallback
  }, [socket, dispatch, moduleName]);
};
