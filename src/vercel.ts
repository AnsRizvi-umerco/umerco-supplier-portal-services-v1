import "dotenv/config";
import { createApp } from "@/create-app";
import { assertEnv } from "@/config/env";

assertEnv();

export = createApp();
