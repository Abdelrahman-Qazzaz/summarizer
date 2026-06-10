import { Hono } from "hono";
import * as authController from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";
import {
  authCallbackRateLimiter,
  authLoginRateLimiter,
  authLogoutRateLimiter,
  authMeRateLimiter,
} from "../middleware/rateLimit.middleware";

export const authRouter = new Hono();

authRouter.get("/login", authLoginRateLimiter, authController.handleLogin);
authRouter.get(
  "/callback",
  authCallbackRateLimiter,
  authController.handleCallback,
);
authRouter.get("/me", authMeRateLimiter, requireAuth, authController.handleMe);
authRouter.post("/logout", authLogoutRateLimiter, authController.handleLogout);
