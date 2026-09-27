import { z } from "zod";

/** A supervisor vouches for an override with their own sign-in, not a shared code. */
export const supervisorOverrideSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email("Enter the supervisor's email").max(255),
    password: z.string().min(1, "Enter the supervisor's password").max(200),
  }),
});

export type SupervisorOverrideInput = z.infer<typeof supervisorOverrideSchema>["body"];
