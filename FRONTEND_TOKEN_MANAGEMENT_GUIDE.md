# Frontend JWT Token & Refresh Token Management Guide

## Overview

This guide shows how to properly implement JWT token management in your frontend, including automatic token refresh, expiration handling, and secure storage.

## 1. Token Structure & Lifecycle

### **Token Types:**

- **Access Token**: Valid for 8 hours, used for API calls
- **Refresh Token**: Valid for 7 days, used to get new access tokens

### **Token Lifecycle:**

```
Login → Get Access Token (8h) + Refresh Token (7d)
  ↓
Use Access Token for API calls
  ↓
Access Token expires (after 8h)
  ↓
Use Refresh Token to get new Access Token
  ↓
Continue using new Access Token
  ↓
Refresh Token expires (after 7d)
  ↓
User must login again
```

## 2. Token Storage & Security

### **Secure Token Storage:**

```typescript
// utils/tokenStorage.ts
class TokenStorage {
  private static ACCESS_TOKEN_KEY = "accessToken";
  private static REFRESH_TOKEN_KEY = "refreshToken";

  // Store tokens securely
  static setTokens(accessToken: string, refreshToken: string) {
    try {
      // Store in localStorage (or use httpOnly cookies for production)
      localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
      localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
    } catch (error) {
      console.error("Failed to store tokens:", error);
    }
  }

  // Get access token
  static getAccessToken(): string | null {
    try {
      return localStorage.getItem(this.ACCESS_TOKEN_KEY);
    } catch (error) {
      console.error("Failed to get access token:", error);
      return null;
    }
  }

  // Get refresh token
  static getRefreshToken(): string | null {
    try {
      return localStorage.getItem(this.REFRESH_TOKEN_KEY);
    } catch (error) {
      console.error("Failed to get refresh token:", error);
      return null;
    }
  }

  // Clear all tokens
  static clearTokens() {
    try {
      localStorage.removeItem(this.ACCESS_TOKEN_KEY);
      localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    } catch (error) {
      console.error("Failed to clear tokens:", error);
    }
  }

  // Check if tokens exist
  static hasTokens(): boolean {
    return !!(this.getAccessToken() && this.getRefreshToken());
  }
}

export default TokenStorage;
```

## 3. Token Validation & Expiration

### **Token Expiration Check:**

```typescript
// utils/tokenUtils.ts
import jwt_decode from "jwt-decode";

interface DecodedToken {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  type: string;
  iat: number; // Issued at (seconds)
  exp: number; // Expires at (seconds)
}

export class TokenUtils {
  // Check if token is expired
  static isTokenExpired(token: string): boolean {
    try {
      const decoded = jwt_decode<DecodedToken>(token);
      const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
      return currentTime >= decoded.exp;
    } catch (error) {
      console.error("Failed to decode token:", error);
      return true; // Consider invalid tokens as expired
    }
  }

  // Get token expiration time
  static getTokenExpirationTime(token: string): Date | null {
    try {
      const decoded = jwt_decode<DecodedToken>(token);
      return new Date(decoded.exp * 1000);
    } catch (error) {
      console.error("Failed to decode token:", error);
      return null;
    }
  }

  // Get time until token expires (in minutes)
  static getTimeUntilExpiry(token: string): number {
    try {
      const decoded = jwt_decode<DecodedToken>(token);
      const currentTime = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = decoded.exp - currentTime;
      return Math.max(0, Math.floor(timeUntilExpiry / 60)); // Convert to minutes
    } catch (error) {
      return 0;
    }
  }

  // Check if token will expire soon (within 5 minutes)
  static isTokenExpiringSoon(
    token: string,
    thresholdMinutes: number = 5
  ): boolean {
    const timeUntilExpiry = this.getTimeUntilExpiry(token);
    return timeUntilExpiry <= thresholdMinutes;
  }

  // Get user info from token
  static getUserFromToken(
    token: string
  ): { id: string; email: string; role: string; tenantId: string } | null {
    try {
      const decoded = jwt_decode<DecodedToken>(token);
      return {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        tenantId: decoded.tenantId,
      };
    } catch (error) {
      return null;
    }
  }
}
```

## 4. Authentication Service

### **Complete Authentication Service:**

```typescript
// services/authService.ts
import TokenStorage from "../utils/tokenStorage";
import { TokenUtils } from "../utils/tokenUtils";

interface LoginCredentials {
  email: string;
  pin: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    tenantId: string;
    tenant: {
      id: string;
      name: string;
      slug: string;
      logo: string;
    };
  };
}

class AuthService {
  private baseURL: string;
  private refreshPromise: Promise<string> | null = null;

  constructor(baseURL: string = "/api/v1") {
    this.baseURL = baseURL;
  }

  // Login with email and pin
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    try {
      const response = await fetch(`${this.baseURL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Login failed");
      }

      const data = await response.json();

      // Store tokens
      TokenStorage.setTokens(data.data.accessToken, data.data.refreshToken);

      return data.data;
    } catch (error) {
      console.error("Login error:", error);
      throw error;
    }
  }

  // Logout
  async logout(): Promise<void> {
    try {
      const refreshToken = TokenStorage.getRefreshToken();

      if (refreshToken) {
        // Call logout endpoint to invalidate refresh token
        await fetch(`${this.baseURL}/auth/logout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refreshToken }),
        });
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      // Clear tokens regardless of API call success
      TokenStorage.clearTokens();
    }
  }

  // Refresh access token
  async refreshAccessToken(): Promise<string> {
    // If there's already a refresh in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performTokenRefresh();
    return this.refreshPromise;
  }

  private async performTokenRefresh(): Promise<string> {
    try {
      const refreshToken = TokenStorage.getRefreshToken();

      if (!refreshToken) {
        throw new Error("No refresh token available");
      }

      const response = await fetch(`${this.baseURL}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        throw new Error("Token refresh failed");
      }

      const data = await response.json();
      const newAccessToken = data.data.accessToken;

      // Update stored access token
      TokenStorage.setTokens(newAccessToken, refreshToken);

      return newAccessToken;
    } catch (error) {
      console.error("Token refresh error:", error);
      // Clear tokens on refresh failure
      TokenStorage.clearTokens();
      throw error;
    } finally {
      this.refreshPromise = null;
    }
  }

  // Get current access token (with auto-refresh if needed)
  async getValidAccessToken(): Promise<string | null> {
    const accessToken = TokenStorage.getAccessToken();

    if (!accessToken) {
      return null;
    }

    // Check if token is expired or expiring soon
    if (
      TokenUtils.isTokenExpired(accessToken) ||
      TokenUtils.isTokenExpiringSoon(accessToken)
    ) {
      try {
        return await this.refreshAccessToken();
      } catch (error) {
        // Refresh failed, redirect to login
        this.handleAuthFailure();
        return null;
      }
    }

    return accessToken;
  }

  // Handle authentication failure
  private handleAuthFailure() {
    TokenStorage.clearTokens();
    // Redirect to login page
    window.location.href = "/login";
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    const accessToken = TokenStorage.getAccessToken();
    return accessToken ? !TokenUtils.isTokenExpired(accessToken) : false;
  }

  // Get current user info
  getCurrentUser() {
    const accessToken = TokenStorage.getAccessToken();
    return accessToken ? TokenUtils.getUserFromToken(accessToken) : null;
  }
}

export default new AuthService();
```

## 5. API Client with Automatic Token Management

### **API Client with Token Refresh:**

```typescript
// services/apiClient.ts
import AuthService from "./authService";

class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = "/api/v1") {
    this.baseURL = baseURL;
  }

  // Generic request method with automatic token management
  async request(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    // Get valid access token
    const token = await AuthService.getValidAccessToken();

    if (!token) {
      throw new Error("No valid access token available");
    }

    // Prepare request with authorization header
    const requestOptions: RequestInit = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    };

    // Make the request
    const response = await fetch(`${this.baseURL}${endpoint}`, requestOptions);

    // Handle 401 responses (token expired)
    if (response.status === 401) {
      try {
        // Try to refresh the token
        const newToken = await AuthService.refreshAccessToken();

        // Retry the request with new token
        const retryOptions: RequestInit = {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${newToken}`,
            ...options.headers,
          },
        };

        return await fetch(`${this.baseURL}${endpoint}`, retryOptions);
      } catch (error) {
        // Refresh failed, redirect to login
        AuthService.logout();
        throw new Error("Authentication failed");
      }
    }

    return response;
  }

  // GET request
  async get(endpoint: string): Promise<Response> {
    return this.request(endpoint, { method: "GET" });
  }

  // POST request
  async post(endpoint: string, data?: any): Promise<Response> {
    return this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // PUT request
  async put(endpoint: string, data?: any): Promise<Response> {
    return this.request(endpoint, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // PATCH request
  async patch(endpoint: string, data?: any): Promise<Response> {
    return this.request(endpoint, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // DELETE request
  async delete(endpoint: string): Promise<Response> {
    return this.request(endpoint, { method: "DELETE" });
  }
}

export default new ApiClient();
```

## 6. React Hook for Authentication

### **Authentication Hook:**

```typescript
// hooks/useAuth.ts
import { useState, useEffect, useCallback } from "react";
import AuthService from "../services/authService";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
    logo: string;
  };
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);

      if (AuthService.isAuthenticated()) {
        const currentUser = AuthService.getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
          setIsAuthenticated(true);
        }
      }
    } catch (error) {
      console.error("Auth check error:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, pin: string) => {
    try {
      setIsLoading(true);
      const loginData = await AuthService.login({ email, pin });
      setUser(loginData.user);
      setIsAuthenticated(true);
      return loginData;
    } catch (error) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await AuthService.logout();
    } finally {
      setUser(null);
      setIsAuthenticated(false);
    }
  }, []);

  const refreshToken = useCallback(async () => {
    try {
      const newToken = await AuthService.refreshAccessToken();
      return newToken;
    } catch (error) {
      // Refresh failed, logout user
      await logout();
      throw error;
    }
  }, [logout]);

  return {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout,
    refreshToken,
    checkAuthStatus,
  };
};
```

## 7. Protected Route Component

### **Route Protection:**

```typescript
// components/ProtectedRoute.tsx
import React from "react";
import { useAuth } from "../hooks/useAuth";
import { Navigate, useLocation } from "react-router-dom";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: string[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredRoles = [],
}) => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    // Redirect to login with return URL
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role requirements
  if (requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
```

## 8. Usage Examples

### **Login Component:**

```tsx
// components/Login.tsx
import React, { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useNavigate, useLocation } from "react-router-dom";

const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname || "/dashboard";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      await login(email, pin);
      navigate(from, { replace: true });
    } catch (error: any) {
      setError(error.message || "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="pin" className="sr-only">
              PIN
            </label>
            <input
              id="pin"
              name="pin"
              type="password"
              required
              className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Login;
```

### **API Usage:**

```tsx
// Example of using the API client
import apiClient from "../services/apiClient";

const fetchMenuItems = async () => {
  try {
    const response = await apiClient.get("/menu/items");
    if (response.ok) {
      const data = await response.json();
      return data.data.items;
    }
  } catch (error) {
    console.error("Failed to fetch menu items:", error);
  }
};

const updateMenuItemAvailability = async (
  itemId: string,
  available: boolean
) => {
  try {
    const response = await apiClient.patch(
      `/menu/items/${itemId}/availability`,
      {
        available,
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.data.item;
    }
  } catch (error) {
    console.error("Failed to update availability:", error);
  }
};
```

## 9. Best Practices

### **Security:**

1. **Never store sensitive data** in localStorage (use httpOnly cookies in production)
2. **Always validate tokens** before making API calls
3. **Implement proper error handling** for token refresh failures
4. **Use HTTPS** in production

### **Performance:**

1. **Implement token refresh** before expiration (not after)
2. **Cache user data** to reduce API calls
3. **Use debouncing** for rapid API calls

### **User Experience:**

1. **Show loading states** during authentication
2. **Handle token refresh** transparently
3. **Provide clear error messages** for auth failures
4. **Remember return URLs** after login

## 10. Troubleshooting

### **Common Issues:**

1. **Token expired too early**: Check timezone and clock synchronization
2. **Refresh token not working**: Verify refresh endpoint and token storage
3. **Infinite refresh loop**: Check refresh logic and error handling
4. **CORS issues**: Ensure proper headers and credentials

### **Debug Tools:**

Use the debug endpoint we created:

```typescript
// Test token details
const debugToken = async (token: string) => {
  const response = await fetch("/api/v1/auth/debug-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await response.json();
  console.log("Token Debug:", data);
};
```

This comprehensive guide provides everything you need to implement robust JWT token management in your frontend! 🚀
