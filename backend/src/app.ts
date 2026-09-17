import cors from "cors";
import express from "express";
import helmet from "helmet";

import { env } from "./config/env";
import { errorHandler } from "./middleware/error-handler";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok"
  });
});

app.use(errorHandler);

export default app;