import { serve } from "https://deno.land/std@0.140.0/http/server.ts";
import { tagNoVoid as tag } from "https://deno.land/x/markup_tag@0.4.0/mod.ts";

import AtprotoAPI from "npm:@atproto/api";
const { BskyAgent } = AtprotoAPI;
const service = "https://bsky.social";
const agent = new BskyAgent({ service });

serve(async (request: Request) => {
  const { pathname } = new URL(request.url);
  console.log(pathname);

  if (pathname === "/") {
    return new Response("access to /your-username", {
    headers: { "content-type": "text/plain" },
    });
  }
  if (pathname === "/favicon.ico") {
    return new Response("", {
    headers: { "content-type": "text/plain" },
    });
  }

  const handle = pathname.replace(/^\//, "");
  const makeURL = (recordDid: string) => {
    const rkey = recordDid.match(/app\.bsky\.feed\.post\/(\w+)/)?.at(1);
    return `https://staging.bsky.app/profile/${handle}/post/${rkey}`;
  };

  const resolve = await agent.com.atproto.identity.resolveHandle({ handle });
  const repo = resolve.data.did;

  const limit = 5
  const feeds = await agent.app.bsky.feed.post.list({ repo, limit });
  const body = feeds.records.map((record) =>
    tag(
      "item",
      tag("title", record.value.text),
      tag("link", makeURL(record.uri)),
      tag("guid", record.uri),
      tag("pubDate", record.value.createdAt),
    )
  );

  const prefix = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const res = tag(
    "rss",
    { version: "2.0", "xmlns:atom": "http://www.w3.org/2005/Atom" },
    tag(
      "channel",
      tag("title", `${handle}'s bsky feed`),
      tag("link", `https://staging.bsky.app/profile/${handle}`),
      tag("description", `user feed in ${service}`),
      tag("lastBuildDate", feeds.records?.at(0)?.value.createdAt || ""),
      ...body,
    ),
  );
  return new Response(prefix + res, {
    headers: { "content-type": "application/xml" },
  });
});
