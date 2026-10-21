/**
 * Whether a daily plan can start production: the material issue step needs the order's raw
 * materials. An order with none opened an empty issue dialog whose Confirm could not succeed (H37).
 */
export const hasMaterialsToIssue = (
  order:
    | {
        draftRawMaterials?: unknown[] | null;
        rawMaterials?: unknown[] | null;
      }
    | null
    | undefined
): boolean => (order?.draftRawMaterials?.length ?? 0) > 0 || (order?.rawMaterials?.length ?? 0) > 0;

/** Start Production is blocked for a planned plan whose order has no raw materials. */
export const isStartBlocked = (
  plan: { status?: string; productionOrder?: unknown },
  order: Parameters<typeof hasMaterialsToIssue>[0]
): boolean => plan.status === "PLANNED" && !hasMaterialsToIssue(order);
