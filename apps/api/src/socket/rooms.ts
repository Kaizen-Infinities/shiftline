// Room names shared by the socket server and lib/realtime.ts.

/** Socket.io room for one tenant. Every authenticated socket joins its own. */
export const tenantRoom = (companyId: string) => `tenant:${companyId}`;

/** Room for platform admins (no tenant selected). */
export const PLATFORM_ROOM = "platform";

/** Room for one signed-in user across all their sockets (notifications). */
export const userRoom = (userId: string) => `user:${userId}`;

/** Room for every socket opened with one login session (revocation). */
export const sessionRoom = (sessionId: string) => `session:${sessionId}`;

/** Room for every socket of one native device (revocation). */
export const deviceRoom = (deviceId: string) => `device:${deviceId}`;

/** Room for the sockets of one impersonation session (revocation). */
export const impersonationRoom = (id: string) => `impersonation:${id}`;
