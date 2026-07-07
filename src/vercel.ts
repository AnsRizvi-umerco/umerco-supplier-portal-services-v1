import "dotenv/config";
import { createApp } from "@/app";
import { assertEnv } from "@/config/env";

assertEnv();

export = createApp();
