import { Hono } from "hono";
import * as authController from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const authRouter = new Hono();

authRouter.get("/login", authController.handleLogin);
authRouter.get("/callback", authController.handleCallback);
authRouter.get("/me", requireAuth, authController.handleMe);
authRouter.post("/logout", authController.handleLogout);
