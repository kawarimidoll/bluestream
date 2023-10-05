import { assertEquals, assertExists } from "std/assert/mod.ts";

import { login } from "./login.ts";

Deno.test("login once", async () => {
  const agent1 = await login();
  assertExists(agent1.session!.did);

  const agent2 = await login();
  assertEquals(agent1.session!.did, agent2.session!.did);
});
