import { Hono } from "hono";
import { cors } from "hono/cors";
import { uploadRouter } from "./routes/upload.router";

export function registerRoutes(app: Hono) {
  app.route("/upload", uploadRouter);
}

const app = new Hono();
app.use("*", cors());
registerRoutes(app);
const port = Number(process.env.PORT) || 3001;

export default {
  port,
  fetch: app.fetch,
};
