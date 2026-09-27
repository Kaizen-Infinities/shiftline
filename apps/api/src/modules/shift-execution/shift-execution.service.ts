import { UserStatus } from "../../types/auth.types";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { ApiError } from "../../utils/ApiError";
import { comparePassword } from "../../utils/hashPassword";
import { authRepository } from "../auth/auth.repository";
import type { SupervisorOverrideInput } from "./shift-execution.validation";

/** The permission that lets someone unlock every hour row on the shift console. */
export const SUPERVISE_PERMISSION = "shift-execution.supervise";

interface Actor {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

// One answer for every credential failure, so the endpoint does not reveal which emails exist.
const BAD_CREDENTIALS = "Those details can't unlock supervisor mode";

class ShiftExecutionService {
  /**
   * Verifies a supervisor's own credentials for an override on the shift console. The
   * supervisor must be an active user of the current tenant (the lookup is tenant-scoped)
   * whose role holds `shift-execution.supervise`. Every attempt, granted or not, is audited
   * against the operator whose session asked for it.
   */
  async verifySupervisor(input: SupervisorOverrideInput, actor: Actor) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: input.email, mode: "insensitive" } },
      select: { userId: true, fullName: true, status: true, roleId: true, passwordHash: true },
    });

    const deny = async (
      status: 401 | 403,
      reason: string,
      message: string,
      supervisorId?: string
    ) => {
      await authRepository.createAuditLog({
        entityName: "User",
        entityId: supervisorId ?? actor.userId,
        action: "SUPERVISOR_OVERRIDE_DENIED",
        newValues: { reason, operatorId: actor.userId },
        changedBy: actor.userId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
      logger.warn({ operatorId: actor.userId, reason }, "supervisor override denied");
      throw new ApiError(status, message, "SUPERVISOR_OVERRIDE_DENIED");
    };

    if (!user || user.status !== UserStatus.ACTIVE) {
      return deny(401, "unknown_or_inactive_user", BAD_CREDENTIALS);
    }
    if (!(await comparePassword(input.password, user.passwordHash))) {
      return deny(401, "invalid_password", BAD_CREDENTIALS, user.userId);
    }
    const permissions = await authRepository.findPermissionsByRole(user.roleId);
    if (!permissions.includes(SUPERVISE_PERMISSION)) {
      return deny(
        403,
        "missing_permission",
        "That account isn't allowed to authorise supervisor overrides",
        user.userId
      );
    }

    const grantedAt = new Date();
    await authRepository.createAuditLog({
      entityName: "User",
      entityId: user.userId,
      action: "SUPERVISOR_OVERRIDE_GRANTED",
      newValues: { operatorId: actor.userId },
      changedBy: actor.userId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    logger.info(
      { operatorId: actor.userId, supervisorId: user.userId },
      "supervisor override granted"
    );
    return { supervisorId: user.userId, supervisorName: user.fullName, grantedAt };
  }
}

export default new ShiftExecutionService();
