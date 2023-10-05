import { assertEquals } from "std/assert/mod.ts";
import { getDidFromUri, toUTCString, uriToPostLink } from "./utils.ts";

Deno.test("getDidFromUri", () => {
  const src = "at://did:plc:user/app.bsky.feed.post/rkey";
  const expected = "did:plc:user";
  assertEquals(getDidFromUri(src), expected);
});

Deno.test("toUTCString", () => {
  const src = "2023-01-23T01:23:45.678Z";
  const expected = "Mon, 23 Jan 2023 01:23:45 GMT";
  assertEquals(toUTCString(src), expected);
});

Deno.test("uriToPostLink", () => {
  const src = "at://did:plc:user/app.bsky.feed.post/rkey";

  // usePsky = false
  const expectedBsky = "https://bsky.app/profile/did:plc:user/post/rkey";
  assertEquals(uriToPostLink(src, false), expectedBsky);

  // usePsky = true
  const expectedPsky = "https://psky.app/profile/did:plc:user/post/rkey";
  assertEquals(uriToPostLink(src, true), expectedPsky);
});
