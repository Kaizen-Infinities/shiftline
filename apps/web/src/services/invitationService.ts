import apiClient from "../api/apiClient";

export interface AssignableRole {
  id: number;
  code: string;
  name: string;
}

export interface SentInvitation {
  id: string;
  email: string;
  emailed: boolean;
  acceptUrl?: string;
}

export interface CreateInvitationDto {
  email: string;
  fullName?: string;
  roleId: number;
}

/** Invitations after onboarding (H43). Needs users.create on the API side. */
export const invitationService = {
  assignableRoles: async (): Promise<AssignableRole[]> => {
    const response = await apiClient.get("/invitations/roles");
    return response.data?.data ?? [];
  },

  create: async (data: CreateInvitationDto): Promise<SentInvitation> => {
    const response = await apiClient.post("/invitations", data);
    return response.data?.data ?? response.data;
  },
};
