import { Hono } from "hono";
import * as authController from "../controllers/auth.controller";
export const authRouter = new Hono();

authRouter.get("/login", authController.handleLogin);
authRouter.post("/callback", authController.handleCallback);
