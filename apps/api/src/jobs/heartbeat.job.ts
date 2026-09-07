/**
 * Worker liveness. pg-boss runs this every minute; `/ready` reads the last
 * completion time of the queue to report whether a worker is alive. No table
 * of its own: pg-boss's job history is the record.
 */
export const heartbeatHandler = async () => ({ at: new Date().toISOString(), pid: process.pid });
