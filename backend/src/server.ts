import app from "./app";
import { env } from "./config/env";

app.listen(env.PORT, () => {
  console.log(`OncoEasy backend listening on port ${env.PORT}`);
});