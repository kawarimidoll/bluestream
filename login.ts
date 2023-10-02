import { BLUESKY_SERVICE, IS_DEV } from "./constants.ts";

import { load } from "std/dotenv/mod.ts";
if (IS_DEV) {
  await load({
    defaultsPath: null,
    examplePath: null,
    export: true,
    allowEmptyValues: true,
  });
}

import AtoprotoAPI from "@atproto/api";
const { BskyAgent } = AtoprotoAPI;

const bskyAgent = () => {
  return new BskyAgent({ service: BLUESKY_SERVICE });
};

export type AgentType = ReturnType<typeof bskyAgent>;

// singleton agent
const agent = bskyAgent();

export async function login() {
  if (agent.session) {
    return agent;
  }

  const identifier = Deno.env.get("BLUESKY_IDENTIFIER") || "";
  const password = Deno.env.get("BLUESKY_PASSWORD") || "";

  await agent.login({ identifier, password });
  return agent;
}
