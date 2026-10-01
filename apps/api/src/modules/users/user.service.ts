import { toLocale, type Locale } from "@shiftline/shared";
import { ApiError } from "../../utils/ApiError";
import { UserResponse } from "../../types/user.types";
import { userRepository } from "./user.repository";
import { UserStatus } from "../../types/auth.types";
import employeeService from "../employee/employee.service";
import { prisma } from "../../config/prisma";
import bcrypt from "bcrypt";
import { sendEmail } from "../../utils/mailer";
import { generateWelcomeEmailHtml } from "../../templates/welcomeEmailTemplate";
import { entitlementService } from "../entitlements/entitlement.service";
import { logger } from "../../lib/logger";
export class UserService {
  async getProfile(userId: string): Promise<UserResponse> {
    const user = await userRepository.findUserById(userId);

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    return this.formatUser(user);
  }

  async updateProfile(
    userId: string,
    payload: Partial<Omit<UserResponse, "userId" | "createdOn">>
  ): Promise<UserResponse> {
    const userExists = await userRepository.findUserById(userId);
    if (!userExists) {
      throw new ApiError(404, "User not found");
    }

    // Filter update payload fields
    const updateData: {
      fullName?: string;
      email?: string;
      username?: string;
    } = {};

    if (payload.fullName !== undefined) updateData.fullName = payload.fullName;
    if (payload.email !== undefined) updateData.email = payload.email ?? undefined;
    if (payload.username !== undefined) updateData.username = payload.username;

    const updatedUser = await userRepository.updateUser(userId, updateData);
    return this.formatUser(updatedUser);
  }

  /** TN-04: the signed-in user's UI language. Only ever the caller's own row. */
  async updateMyLocale(userId: string, locale: Locale): Promise<UserResponse> {
    // The platform console stays in English; admins have no users row.
    if (!userId || userId.startsWith("admin_")) {
      throw new ApiError(403, "Language can be set only for company users");
    }
    const userExists = await userRepository.findUserById(userId);
    if (!userExists) {
      throw new ApiError(404, "User not found");
    }
    const updatedUser = await userRepository.updateUser(userId, { locale });
    return this.formatUser(updatedUser);
  }

  async getAllUsers(): Promise<UserResponse[]> {
    const users = await userRepository.findAllUsers();
    return users.map((user) => this.formatUser(user));
  }

  async getUserById(userId: string): Promise<UserResponse> {
    const user = await userRepository.findUserById(userId);

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    return this.formatUser(user);
  }

  async updateUserStatus(userId: string, isActive: boolean): Promise<UserResponse> {
    const userExists = await userRepository.findUserById(userId);
    if (!userExists) {
      throw new ApiError(404, "User not found");
    }

    const status = isActive ? UserStatus.ACTIVE : UserStatus.SUSPENDED;
    const updatedUser = await userRepository.updateUserStatus(userId, status);

    return this.formatUser(updatedUser);
  }

  async create(data: {
    username: string;
    fullName: string;
    email?: string;
    password: string;
    employeeId?: number | null;
    roleId: number;
  }): Promise<UserResponse> {
    const existingUser = await userRepository.findByUsername(data.username);

    if (existingUser) {
      throw new ApiError(400, "Username already exists");
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    let finalEmployeeId: bigint;
    if (data.employeeId) {
      finalEmployeeId = BigInt(data.employeeId);
    } else {
      const empCode = await employeeService.getNextEmployeeCode();
      const employee = await prisma.employee.create({
        data: {
          empCode,
          fullName: data.fullName,
          email: data.email,
          status: "active",
        },
      });
      finalEmployeeId = employee.id;
    }

    // Plan seats (P1-01): active users plus pending invitations.
    await entitlementService.assertSeatAvailable();

    const user = await userRepository.createUser({
      username: data.username,
      fullName: data.fullName,
      email: data.email,
      passwordHash,
      employeeId: finalEmployeeId,
      roleId: data.roleId,
      status: UserStatus.ACTIVE,
      mustChangePw: false,
      createdBy: "ADMIN",
    });
    entitlementService.invalidate();

    if (data.email) {
      try {
        await sendEmail({
          to: data.email,
          subject: "Welcome to Shiftline — Your User Account Has Been Created",
          html: generateWelcomeEmailHtml({
            fullName: data.fullName,
            username: data.username,
            password: data.password,
            title: "Welcome to Shiftline!",
            subtitle: "Your user login account has been created successfully.",
            teamName: "Shiftline Admin Team",
          }),
        });
      } catch (emailErr) {
        logger.error({ err: emailErr }, "Failed to send welcome email (non-fatal):");
      }
    }

    return this.formatUser(user);
  }

  async checkUsernameAvailable(username: string): Promise<{ available: boolean }> {
    const existingUser = await userRepository.findByUsername(username);
    return { available: !existingUser };
  }

  private formatUser(user: any): UserResponse {
    return {
      userId: user.userId,
      fullName: user.fullName,
      email: user.email,
      username: user.username,
      roleId:
        user.role?.name ??
        (user.roleId !== undefined && user.roleId !== null ? user.roleId.toString() : ""),
      status: user.status as UserStatus,
      locale: toLocale(user.locale),
      lastLoginAt: user.lastLoginAt,
      createdOn: user.createdOn,
    };
  }
}

export const userService = new UserService();
