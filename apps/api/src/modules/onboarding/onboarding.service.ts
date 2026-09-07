/**
 * Onboarding wizard (P1-00 part 2). A freshly provisioned tenant walks through
 * company details, GST and places of business, the financial year, bank
 * accounts and first invitations, accepts the terms and is marked onboarded.
 * Every step can be revisited until completion; after completion the ordinary
 * settings screens take over and the wizard endpoints answer 409.
 */
import { GST_STATE_BY_CODE } from "@shiftline/shared";
import type { Company, Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { voucherPostingService } from "../accounts/voucherPosting.service";
import { invitationService } from "../users/invitation.service";
import { notify } from "../notifications/notify";
import {
  ONBOARDING_STEPS,
  STEP_LABELS,
  TOS_VERSION,
  type BankStepInput,
  type CompanyStepInput,
  type FinancialYearStepInput,
  type GstStepInput,
  type OnboardingStep,
  type UsersStepInput,
} from "./onboarding.types";

const BANK_GROUP = "Bank Accounts";
const SETTING_GST_REG_TYPE = "GST_REGISTRATION_TYPE";
const SETTING_BOOKS_BEGIN_ON = "BOOKS_BEGIN_ON";
const SETTING_TOS_VERSION = "TOS_VERSION_ACCEPTED";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `updatedBy` is a uuid column; platform admins (`admin_<n>`) are recorded only in the audit trail. */
const actorUuid = (userId?: string) => (userId && UUID_RE.test(userId) ? userId : null);

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Financial year starting on `start` (first of a month): end, code (`2026-27` or `2026`) and period name. */
export const financialYearFrom = (start: Date) => {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const s = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y + 1, m, 0));
  const code = m === 0 ? `${y}` : `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  return { start: s, end, code, periodName: `FY ${code}` };
};

const stepIndex = (step: string | null | undefined) => {
  const i = ONBOARDING_STEPS.indexOf((step ?? "company") as OnboardingStep);
  return i < 0 ? 0 : i;
};

class OnboardingService {
  // ─── State ──────────────────────────────────────────────────────────────────

  async getState() {
    const companyId = requireTenantId();
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: { businessPlaces: { orderBy: { id: "asc" } } },
    });
    if (!company) throw new ApiError(404, "Company not found");

    const [invoiceSetting, settings, users, invitations, roles, bank, bankAccounts] =
      await Promise.all([
        prisma.invoiceSetting.findUnique({ where: { companyId } }),
        prisma.systemSetting.findMany({
          where: {
            key: { in: [SETTING_GST_REG_TYPE, SETTING_BOOKS_BEGIN_ON, SETTING_TOS_VERSION] },
          },
        }),
        prisma.user.findMany({
          orderBy: { createdOn: "asc" },
          select: {
            userId: true,
            fullName: true,
            email: true,
            status: true,
            role: { select: { code: true, name: true } },
          },
        }),
        prisma.invitation.findMany({
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            email: true,
            fullName: true,
            expiresAt: true,
            role: { select: { code: true, name: true } },
          },
        }),
        prisma.role.findMany({
          orderBy: { name: "asc" },
          select: { id: true, code: true, name: true, description: true },
        }),
        accountsService.getBankAccounts(),
        prisma.bankAccount.findMany(),
      ]);

    const setting = (key: string) => settings.find((s) => s.key === key)?.value ?? null;
    const current = company.isOnboarded
      ? null
      : ONBOARDING_STEPS[stepIndex(company.onboardingStep)];
    const currentIdx = company.isOnboarded ? ONBOARDING_STEPS.length : stepIndex(current);
    const fy = invoiceSetting ? financialYearFrom(invoiceSetting.financialYearStart) : null;
    const detailsByLedger = new Map(bankAccounts.map((b) => [b.ledgerId, b]));

    return {
      step: current,
      isOnboarded: company.isOnboarded,
      steps: ONBOARDING_STEPS.map((key, idx) => ({
        key,
        label: STEP_LABELS[key],
        done: idx < currentIdx,
      })),
      tos: {
        version: TOS_VERSION,
        acceptedAt: company.tosAcceptedAt,
        acceptedBy: company.tosAcceptedBy,
        accepted: !!company.tosAcceptedAt && setting(SETTING_TOS_VERSION) === TOS_VERSION,
      },
      company: {
        id: company.id,
        companyCode: company.companyCode,
        slug: company.slug,
        companyName: company.companyName,
        legalName: company.legalName,
        shortName: company.shortName,
        email: company.email,
        phone: company.phone,
        website: company.website,
        addressLine1: company.addressLine1,
        city: company.city,
        state: company.state,
        zipcode: company.zipcode,
        country: company.country,
        gstin: company.gstin,
      },
      gst: {
        registrationType: setting(SETTING_GST_REG_TYPE) ?? (company.gstin ? "REGULAR" : null),
        gstin: company.gstin,
        businessPlaces: company.businessPlaces.map((p) => {
          const address = (p.address ?? {}) as Record<string, unknown>;
          return {
            id: p.id.toString(),
            code: p.code,
            name: p.name,
            type: p.type,
            gstPlaceCode: p.gstPlaceCode,
            phone: p.phone,
            email: p.email,
            isHeadOffice: p.isHeadOffice,
            isActive: p.isActive,
            addressLine1: (address.line1 as string | undefined) ?? null,
            city: (address.city as string | undefined) ?? null,
            zipcode: (address.zipcode as string | undefined) ?? null,
          };
        }),
      },
      financialYear: fy
        ? {
            start: isoDate(fy.start),
            end: isoDate(fy.end),
            code: fy.code,
            periodName: fy.periodName,
            booksBeginOn: setting(SETTING_BOOKS_BEGIN_ON) ?? isoDate(fy.start),
          }
        : null,
      bankAccounts: bank.accounts
        .filter((a) => a.group.toLowerCase() === BANK_GROUP.toLowerCase())
        .map((a) => {
          const d = detailsByLedger.get(a.id);
          return {
            ledgerId: a.id,
            code: a.code,
            name: a.name,
            currentBalance: a.currentBalance,
            hasOpeningBalance: a.hasOpeningBalance,
            bankName: d?.bankName ?? null,
            accountName: d?.accountName ?? null,
            accountNumber: d?.accountNumber ?? null,
            ifsc: d?.ifsc ?? null,
            branch: d?.branch ?? null,
            upiId: d?.upiId ?? null,
            isDefault: d?.isDefault ?? false,
          };
        }),
      users: users.map((u) => ({
        userId: u.userId,
        fullName: u.fullName,
        email: u.email,
        status: u.status,
        roleCode: u.role?.code ?? null,
        roleName: u.role?.name ?? null,
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        fullName: i.fullName,
        expiresAt: i.expiresAt,
        roleCode: i.role.code,
        roleName: i.role.name,
      })),
      roles,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** The tenant's company row, refusing wizard writes once onboarding is complete. */
  private async writable(): Promise<Company> {
    const company = await prisma.company.findUnique({ where: { id: requireTenantId() } });
    if (!company) throw new ApiError(404, "Company not found");
    if (company.isOnboarded) {
      throw new ApiError(409, "Onboarding is complete; use the settings screens to make changes");
    }
    return company;
  }

  /** Moves the pointer past `step` when the tenant had not already gone further. */
  private async advance(company: Company, step: OnboardingStep, userId?: string) {
    const currentIdx = stepIndex(company.onboardingStep);
    const doneIdx = ONBOARDING_STEPS.indexOf(step);
    if (doneIdx < currentIdx) return company.onboardingStep;
    const next = ONBOARDING_STEPS[Math.min(doneIdx + 1, ONBOARDING_STEPS.length - 1)];
    await prisma.company.update({
      where: { id: company.id },
      data: { onboardingStep: next, updatedBy: actorUuid(userId) },
    });
    return next;
  }

  private async setSetting(key: string, value: string) {
    await prisma.systemSetting.upsert({
      where: { companyId_key: { companyId: requireTenantId(), key } },
      update: { value },
      create: { key, value },
    });
  }

  // ─── Steps ──────────────────────────────────────────────────────────────────

  async saveCompany(input: CompanyStepInput, userId?: string) {
    const company = await this.writable();
    await prisma.company.update({
      where: { id: company.id },
      data: {
        companyName: input.companyName,
        legalName: input.legalName ?? input.companyName,
        shortName: input.shortName,
        email: input.email || null,
        phone: input.phone,
        website: input.website || null,
        addressLine1: input.addressLine1,
        city: input.city,
        state: input.state,
        zipcode: input.zipcode,
        country: input.country ?? "India",
        updatedBy: actorUuid(userId),
      },
    });
    return { step: await this.advance(company, "company", userId) };
  }

  async saveGst(input: GstStepInput, userId?: string) {
    const company = await this.writable();
    const gstin = input.registrationType === "UNREGISTERED" ? null : input.gstin!.toUpperCase();
    const existing = await prisma.businessPlace.findMany();
    const keep = new Set<bigint>();

    for (const p of input.businessPlaces) {
      const isHeadOffice = p.isHeadOffice || p.type === "HEAD_OFFICE";
      const data = {
        code: p.code,
        name: p.name,
        type: p.type,
        gstPlaceCode: p.gstPlaceCode,
        phone: p.phone,
        email: p.email || null,
        isHeadOffice,
        isActive: true,
        address: {
          line1: p.addressLine1,
          city: p.city,
          zipcode: p.zipcode,
          stateCode: p.gstPlaceCode,
          state: GST_STATE_BY_CODE.get(p.gstPlaceCode)?.name ?? null,
        } as Prisma.InputJsonValue,
      };
      const match = p.id
        ? existing.find((e) => e.id === BigInt(p.id!))
        : existing.find((e) => e.code === p.code);
      if (p.id && !match) throw new ApiError(404, `Place of business ${p.id} not found`);
      const row = match
        ? await prisma.businessPlace.update({ where: { id: match.id }, data })
        : await prisma.businessPlace.create({ data });
      keep.add(row.id);
    }

    // Places dropped from the list go, unless machines or stores already point at them.
    for (const e of existing) {
      if (keep.has(e.id)) continue;
      try {
        await prisma.businessPlace.delete({ where: { id: e.id } });
      } catch {
        await prisma.businessPlace.update({
          where: { id: e.id },
          data: { isActive: false, isHeadOffice: false },
        });
      }
    }

    const head = input.businessPlaces.find((p) => p.isHeadOffice || p.type === "HEAD_OFFICE")!;
    await prisma.company.update({
      where: { id: company.id },
      data: {
        gstin,
        state: GST_STATE_BY_CODE.get(head.gstPlaceCode)?.name ?? company.state,
        updatedBy: actorUuid(userId),
      },
    });
    await this.setSetting(SETTING_GST_REG_TYPE, input.registrationType);
    return { step: await this.advance(company, "gst", userId) };
  }

  async saveFinancialYear(input: FinancialYearStepInput, userId?: string) {
    const company = await this.writable();
    const fy = financialYearFrom(input.fyStart);
    const booksBeginOn = input.booksBeginOn ?? fy.start;

    const setting = await prisma.invoiceSetting.findUnique({ where: { companyId: company.id } });
    const oldFy = setting ? financialYearFrom(setting.financialYearStart) : null;
    const changed = !oldFy || oldFy.start.getTime() !== fy.start.getTime();

    if (changed && (await prisma.voucher.count()) > 0) {
      throw new ApiError(
        409,
        "The financial year cannot change once vouchers exist; remove the opening entries first"
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoiceSetting.upsert({
        where: { companyId: company.id },
        update: { financialYearStart: fy.start, financialYearEnd: fy.end },
        create: { invoicePrefix: "INV", financialYearStart: fy.start, financialYearEnd: fy.end },
      });

      if (changed) {
        const period = oldFy
          ? await tx.accountingPeriod.findFirst({
              where: { OR: [{ periodName: oldFy.periodName }, { startDate: oldFy.start }] },
            })
          : null;
        if (period && !period.isClosed) {
          await tx.accountingPeriod.update({
            where: { id: period.id },
            data: { periodName: fy.periodName, startDate: fy.start, endDate: fy.end },
          });
        } else if (
          !(await tx.accountingPeriod.findFirst({
            where: { startDate: { lte: fy.end }, endDate: { gte: fy.start } },
          }))
        ) {
          await tx.accountingPeriod.create({
            data: { periodName: fy.periodName, startDate: fy.start, endDate: fy.end },
          });
        }

        // Unused numbering series move to the new year's code; used ones keep their history.
        if (oldFy) {
          const sequences = await tx.documentSequence.findMany({
            where: { fyCode: oldFy.code, next: 1 },
          });
          for (const seq of sequences) {
            const clash = await tx.documentSequence.findFirst({
              where: {
                docType: seq.docType,
                businessPlaceId: seq.businessPlaceId,
                fyCode: fy.code,
              },
            });
            if (clash) await tx.documentSequence.delete({ where: { id: seq.id } });
            else
              await tx.documentSequence.update({
                where: { id: seq.id },
                data: { fyCode: fy.code },
              });
          }
        }
      }

      await tx.systemSetting.upsert({
        where: { companyId_key: { companyId: company.id, key: SETTING_BOOKS_BEGIN_ON } },
        update: { value: isoDate(booksBeginOn) },
        create: { key: SETTING_BOOKS_BEGIN_ON, value: isoDate(booksBeginOn) },
      });
    });

    return {
      step: await this.advance(company, "financial-year", userId),
      financialYear: {
        start: isoDate(fy.start),
        end: isoDate(fy.end),
        code: fy.code,
        periodName: fy.periodName,
        booksBeginOn: isoDate(booksBeginOn),
      },
    };
  }

  private async nextBankCode() {
    const ledgers = await prisma.accountLedger.findMany({
      where: { code: { startsWith: "BANK-" } },
      select: { code: true },
    });
    const max = ledgers.reduce((m, l) => {
      const n = Number(l.code.slice("BANK-".length));
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return `BANK-${String(max + 1).padStart(3, "0")}`;
  }

  async saveBank(input: BankStepInput, userId?: string) {
    const company = await this.writable();
    const booksBeginOn = await prisma.systemSetting.findUnique({
      where: { companyId_key: { companyId: company.id, key: SETTING_BOOKS_BEGIN_ON } },
    });
    const invoiceSetting = await prisma.invoiceSetting.findUnique({
      where: { companyId: company.id },
    });
    const openingDate = booksBeginOn
      ? new Date(`${booksBeginOn.value}T00:00:00.000Z`)
      : (invoiceSetting?.financialYearStart ?? undefined);

    const bankLedgers = await prisma.accountLedger.findMany({
      where: { type: "ASSET", group: { equals: BANK_GROUP, mode: "insensitive" } },
    });
    const saved: { ledgerId: number; code: string; name: string }[] = [];

    for (const acc of input.accounts) {
      let ledger = acc.ledgerId ? bankLedgers.find((l) => l.id === acc.ledgerId) : undefined;
      if (acc.ledgerId && !ledger) {
        throw new ApiError(404, `Bank ledger ${acc.ledgerId} not found`);
      }
      if (ledger) {
        if (ledger.name !== acc.name || !ledger.isActive) {
          ledger = await prisma.accountLedger.update({
            where: { id: ledger.id },
            data: { name: acc.name, isActive: true },
          });
        }
        if (acc.openingBalance > 0) {
          const posted = await prisma.voucher.findFirst({
            where: { refDocType: "LEDGER_OPENING_BALANCE", refDocId: String(ledger.id) },
          });
          if (!posted) {
            await voucherPostingService.postGenericLedgerOpeningBalanceVoucher(
              ledger,
              acc.openingBalance,
              "DEBIT",
              undefined,
              { date: openingDate }
            );
          }
        }
      } else {
        const code = await this.nextBankCode();
        ledger = await accountsService.createLedger({
          code,
          name: acc.name,
          type: "ASSET",
          group: BANK_GROUP,
          isActive: true,
          openingBalance: 0,
          openingBalanceType: "DEBIT",
        });
        bankLedgers.push(ledger);
        if (acc.openingBalance > 0) {
          await voucherPostingService.postGenericLedgerOpeningBalanceVoucher(
            ledger,
            acc.openingBalance,
            "DEBIT",
            undefined,
            { date: openingDate }
          );
        }
      }

      const details = {
        bankName: acc.bankName,
        accountName: acc.accountName,
        accountNumber: acc.accountNumber || null,
        ifsc: acc.ifsc || null,
        branch: acc.branch,
        upiId: acc.upiId,
        isDefault: acc.isDefault,
        isActive: true,
      };
      await prisma.bankAccount.upsert({
        where: { ledgerId: ledger.id },
        update: details,
        create: { ledgerId: ledger.id, ...details },
      });
      saved.push({ ledgerId: ledger.id, code: ledger.code, name: ledger.name });
    }

    // Exactly one default account when any exist.
    const all = await prisma.bankAccount.findMany({ orderBy: { createdAt: "asc" } });
    if (all.length) {
      const defaults = all.filter((b) => b.isDefault);
      const keepId = (defaults.length ? defaults[defaults.length - 1] : all[0]).id;
      await prisma.bankAccount.updateMany({
        where: { id: { not: keepId }, isDefault: true },
        data: { isDefault: false },
      });
      await prisma.bankAccount.update({ where: { id: keepId }, data: { isDefault: true } });
    }

    return { step: await this.advance(company, "bank", userId), accounts: saved };
  }

  async saveUsers(input: UsersStepInput, userId?: string) {
    const company = await this.writable();
    const roles = await prisma.role.findMany({ select: { id: true, code: true } });
    const results: {
      email: string;
      status: "invited" | "exists" | "error";
      message?: string;
      acceptUrl?: string;
      emailed?: boolean;
    }[] = [];

    for (const inv of input.invitations) {
      const role = roles.find((r) => r.code === inv.roleCode);
      if (!role) {
        results.push({
          email: inv.email,
          status: "error",
          message: `Unknown role ${inv.roleCode}`,
        });
        continue;
      }
      try {
        const r = await invitationService.create(
          {
            email: inv.email,
            fullName: inv.fullName ?? undefined,
            roleId: role.id,
            invitedBy: actorUuid(userId) ?? undefined,
          },
          { companyName: company.companyName }
        );
        results.push({
          email: inv.email,
          status: "invited",
          acceptUrl: r.acceptUrl,
          emailed: r.emailed,
        });
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        results.push({
          email: inv.email,
          status: err.statusCode === 409 ? "exists" : "error",
          message: err.message,
        });
      }
    }

    return { step: await this.advance(company, "users", userId), results };
  }

  async acceptTos(userId?: string) {
    const company = await this.writable();
    const now = new Date();
    await prisma.company.update({
      where: { id: company.id },
      data: {
        tosAcceptedAt: now,
        tosAcceptedBy: userId?.slice(0, 36) ?? null,
        updatedBy: actorUuid(userId),
      },
    });
    await this.setSetting(SETTING_TOS_VERSION, TOS_VERSION);
    return { version: TOS_VERSION, acceptedAt: now, acceptedBy: userId ?? null };
  }

  async complete(userId?: string) {
    const company = await this.writable();
    const idx = stepIndex(company.onboardingStep);
    if (ONBOARDING_STEPS[idx] !== "review") {
      const missing = ONBOARDING_STEPS.slice(idx, -1).map((s) => STEP_LABELS[s]);
      throw new ApiError(409, `Finish the remaining steps first: ${missing.join(", ")}`);
    }
    const tosVersion = await prisma.systemSetting.findUnique({
      where: { companyId_key: { companyId: company.id, key: SETTING_TOS_VERSION } },
    });
    if (!company.tosAcceptedAt || tosVersion?.value !== TOS_VERSION) {
      throw new ApiError(409, "Accept the terms of service to finish onboarding");
    }
    const updated = await prisma.company.update({
      where: { id: company.id },
      data: { isOnboarded: true, onboardingStep: null, updatedBy: actorUuid(userId) },
      include: { businessPlaces: true },
    });
    await notify({
      category: "onboarding",
      level: "SUCCESS",
      title: "Setup complete",
      body: `${updated.companyName} is ready to use.`,
      link: "/dashboard",
      to: { all: true, exclude: [userId] },
      createdBy: userId,
    });
    return {
      ...updated,
      businessPlaces: updated.businessPlaces.map((bp) => ({ ...bp, id: bp.id.toString() })),
    };
  }
}

export const onboardingService = new OnboardingService();
