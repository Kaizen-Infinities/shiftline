import { API_PATHS, type Locale } from "@shiftline/shared";
import apiClient from "../api/apiClient";
import config from "../api/config";

export const profileService = {
  fetchProfile: async () => {
    const response = await apiClient.get(`${config?.employee?.me}`);
    return response.data?.data || response.data;
  },
  /** TN-04: saves the signed-in user's UI language; returns the updated user. */
  updateMyLocale: async (locale: Locale) => {
    const response = await apiClient.patch(API_PATHS.user.myLocale, { locale });
    return response.data?.data;
  },
};

export default profileService;
