import { Request, Response } from "express";

import { ApiResponse } from "../../utils/ApiResponse";
import { onboardingService } from "./onboarding.service";
import type {
  BankStepInput,
  CompanyStepInput,
  FinancialYearStepInput,
  GstStepInput,
  UsersStepInput,
} from "./onboarding.types";

const actor = (req: Request) => req.user?.userId;

export const onboardingController = {
  state: async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Onboarding state", await onboardingService.getState()));
  },

  saveCompany: async (req: Request, res: Response) => {
    const result = await onboardingService.saveCompany(req.body as CompanyStepInput, actor(req));
    res.json(new ApiResponse("Company details saved", result));
  },

  saveGst: async (req: Request, res: Response) => {
    const result = await onboardingService.saveGst(req.body as GstStepInput, actor(req));
    res.json(new ApiResponse("GST details saved", result));
  },

  saveFinancialYear: async (req: Request, res: Response) => {
    const result = await onboardingService.saveFinancialYear(
      req.body as FinancialYearStepInput,
      actor(req)
    );
    res.json(new ApiResponse("Financial year saved", result));
  },

  saveBank: async (req: Request, res: Response) => {
    const result = await onboardingService.saveBank(req.body as BankStepInput, actor(req));
    res.json(new ApiResponse("Bank accounts saved", result));
  },

  saveUsers: async (req: Request, res: Response) => {
    const result = await onboardingService.saveUsers(req.body as UsersStepInput, actor(req));
    res.json(new ApiResponse("Invitations sent", result));
  },

  acceptTos: async (req: Request, res: Response) => {
    res.json(new ApiResponse("Terms accepted", await onboardingService.acceptTos(actor(req))));
  },

  complete: async (req: Request, res: Response) => {
    res.json(new ApiResponse("Onboarding complete", await onboardingService.complete(actor(req))));
  },
};
