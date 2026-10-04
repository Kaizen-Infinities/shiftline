/**
 * The only shape in which a User row may leave the API inside another model's response
 * (employee lists, details, event payloads). Never `include: { user: true }` or
 * `include: { user: { include: ... } }`: that returns passwordHash and mfaSecret.
 */
export const safeUserSelect = {
  userId: true,
  username: true,
  fullName: true,
  email: true,
  status: true,
  mustChangePw: true,
  roleId: true,
  role: { select: { id: true, name: true } },
} as const;
