import "dotenv/config";
import { createApp } from "@/create-app";
import { assertEnv } from "@/config/env";

assertEnv();

const port = Number(process.env.PORT || 3001);
const app = createApp();

app.listen(port, () => {
  console.log(`Services API listening on http://localhost:${port}/api/v1`);
});
