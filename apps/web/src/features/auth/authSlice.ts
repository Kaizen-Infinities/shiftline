import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import authService from "../../services/authService";
import { refreshAccessToken } from "../../api/refresh";
import type { AuthState, UserResponseDto, LoginDto, ProfileResponseDto } from "./types";

const decodePermissions = (token: string): string[] => {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const decoded = JSON.parse(jsonPayload);
    return decoded.permissions || [];
  } catch {
    return [];
  }
};

const initialState: AuthState = {
  user: null,
  permissions: [],
  accessToken: null,
  accessTokenExpiresAt: null,
  isAuthenticated: false,
  isLoading: false,
  isInitialized: false,
  entitlements: null,
};

// Async Thunks
export const loginUser = createAsyncThunk("auth/login", async (credentials: LoginDto, thunkAPI) => {
  try {
    const response = await authService.login(credentials);
    const { accessToken, accessTokenExpiresAt, user } = response.data || {};

    // Set access token first so subsequent requests (like get profile) carry it
    thunkAPI.dispatch(
      setAccessToken({ accessToken, accessTokenExpiresAt: accessTokenExpiresAt ?? null })
    );
    return user as UserResponseDto;
  } catch (err: any) {
    const message = err.response?.data?.message || "Login failed";
    return thunkAPI.rejectWithValue(message);
  }
});

export const getCurrentUser = createAsyncThunk("auth/getCurrentUser", async (_, thunkAPI) => {
  try {
    const response = await authService.getCurrentUser();
    return response.data as ProfileResponseDto;
  } catch (err: any) {
    const message = err.response?.data?.message || "Failed to fetch user profile";
    return thunkAPI.rejectWithValue(message);
  }
});

export const logoutUser = createAsyncThunk("auth/logout", async (_, thunkAPI) => {
  try {
    await authService.logout();
  } catch (err) {
    console.error("Logout request failed:", err);
  } finally {
    thunkAPI.dispatch(clearUser());
  }
});

export const initializeAuth = createAsyncThunk("auth/initialize", async (_, thunkAPI) => {
  // The access token lives in memory only; on a fresh page the httpOnly
  // refresh cookie (if any) is exchanged for a new one.
  const refreshed = await refreshAccessToken();
  if (!refreshed) return null;
  thunkAPI.dispatch(setAccessToken(refreshed));
  try {
    const userResponse = await authService.getCurrentUser();
    return userResponse.data as ProfileResponseDto;
  } catch {
    return null;
  }
});

/** Called by the proactive timer and the 401 handlers after a successful rotation. */
export const tokenRefreshed = createAsyncThunk(
  "auth/tokenRefreshed",
  async (payload: { accessToken: string; accessTokenExpiresAt: string | null }, thunkAPI) => {
    thunkAPI.dispatch(setAccessToken(payload));
    return payload;
  }
);

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setAccessToken: (
      state,
      action: PayloadAction<{ accessToken: string; accessTokenExpiresAt: string | null }>
    ) => {
      state.accessToken = action.payload.accessToken;
      state.accessTokenExpiresAt = action.payload.accessTokenExpiresAt;
      state.permissions = action.payload.accessToken
        ? decodePermissions(action.payload.accessToken)
        : [];
      // Never persisted: a fresh page renews it from the httpOnly cookie.
      localStorage.removeItem("accessToken");
      sessionStorage.removeItem("accessToken");
    },
    clearUser: (state) => {
      state.user = null;
      state.entitlements = null;
      state.accessToken = null;
      state.accessTokenExpiresAt = null;
      state.permissions = [];
      state.isAuthenticated = false;
      localStorage.removeItem("accessToken");
      sessionStorage.removeItem("accessToken");
    },
  },
  extraReducers: (builder) => {
    // Login thunk
    builder.addCase(loginUser.pending, (state) => {
      state.isLoading = true;
    });
    builder.addCase(loginUser.fulfilled, (state, action: PayloadAction<UserResponseDto>) => {
      state.user = action.payload;
      state.isAuthenticated = true;
      state.isLoading = false;
    });
    builder.addCase(loginUser.rejected, (state) => {
      state.isLoading = false;
      state.user = null;
      state.accessToken = null;
      state.permissions = [];
      state.isAuthenticated = false;
    });

    // Get Current User thunk
    builder.addCase(
      getCurrentUser.fulfilled,
      (state, action: PayloadAction<ProfileResponseDto>) => {
        state.user = action.payload.user;
        state.permissions = action.payload.permissions;
        state.entitlements = action.payload.entitlements ?? null;
        state.isAuthenticated = true;
      }
    );
    builder.addCase(getCurrentUser.rejected, (state) => {
      state.user = null;
      state.accessToken = null;
      state.permissions = [];
      state.isAuthenticated = false;
    });

    // Initialize thunk
    builder.addCase(initializeAuth.pending, (state) => {
      state.isLoading = true;
    });
    builder.addCase(
      initializeAuth.fulfilled,
      (state, action: PayloadAction<ProfileResponseDto | null>) => {
        if (action.payload) {
          state.user = action.payload.user;
          state.permissions = action.payload.permissions;
          state.isAuthenticated = true;
        }
        state.isLoading = false;
        state.isInitialized = true;
      }
    );
    builder.addCase(initializeAuth.rejected, (state) => {
      state.isLoading = false;
      state.isInitialized = true;
      state.user = null;
      state.accessToken = null;
      state.permissions = [];
      state.isAuthenticated = false;
    });
  },
});

export const { setAccessToken, clearUser } = authSlice.actions;
export default authSlice.reducer;
