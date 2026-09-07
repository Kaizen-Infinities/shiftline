import apiClient from "../api/apiClient";
import config from "../api/config";

/** Document numbering (P1-08): the number the next save would take, per series. */
export const documentsService = {
  nextNumber: async (
    docType: string,
    opts: { businessPlaceId?: string | number | null; date?: string } = {}
  ): Promise<string> => {
    const res = await apiClient.get(config.documents.nextNumber, {
      params: {
        docType,
        ...(opts.businessPlaceId ? { businessPlaceId: String(opts.businessPlaceId) } : {}),
        ...(opts.date ? { date: opts.date } : {}),
      },
    });
    return res.data?.data?.number ?? "";
  },
};
