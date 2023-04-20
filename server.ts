import { serve } from "https://deno.land/std@0.140.0/http/server.ts";
import {
  sanitize,
  tagNoVoid as tag,
} from "https://deno.land/x/markup_tag@0.4.0/mod.ts";

import BskyAgent from "https://esm.sh/@atproto/api@0.2.7";
const service = "https://bsky.social";
const agent = new BskyAgent({ service });

async function resolveHandle(handle: string) {
  try {
    const resolve = await agent.api.com.atproto.identity.resolveHandle({
      handle,
    });
    return resolve.data.did;
  } catch (error) {
    console.error(error);
    return "";
  }
}

serve(async (request: Request) => {
  const { href, pathname } = new URL(request.url);
  if (!Deno.env.get("DENO_DEPLOYMENT_ID")) {
    console.log(pathname);
  }

  if (pathname === "/") {
    const file = await Deno.readFile("./index.html");
    return new Response(file, {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
  }
  if (pathname === "/favicon.ico") {
    return new Response("", {
      headers: { "content-type": "text/plain" },
    });
  }

  const handle = pathname.replace(/^\//, "");
  const prof = `https://staging.bsky.app/profile/${handle}`;

  const repo = await resolveHandle(handle);
  if (repo === "") {
    return new Response("Unable to resolve handle", {
      headers: { "content-type": "text/plain" },
    });
  }

  const limit = 15;
  const feeds = await agent.api.app.bsky.feed.post.list({ repo, limit });
  if (!feeds) {
    return new Response("Unable to get posts", {
      headers: { "content-type": "text/plain" },
    });
  }

  const prefix = '<?xml version="1.0" encoding="UTF-8"?>';
  const res = tag(
    "rss",
    {
      version: "2.0",
      "xmlns:atom": "http://www.w3.org/2005/Atom",
      "xmlns:dc": "http://purl.org/dc/elements/1.1/",
    },
    tag(
      "channel",
      tag("title", `Bluestream (${handle})`),
      `<atom:link href="${href}" rel="self" type="application/rss+xml" />`,
      tag("link", prof),
      tag("description", `${handle}'s posts in ${service}`),
      tag("lastBuildDate", feeds.records?.at(0)?.value.createdAt || ""),
      ...feeds.records.map((record) =>
        tag(
          "item",
          tag("title", sanitize(record.value.text)),
          tag("description", sanitize(record.value.text)),
          tag(
            "link",
            `${prof}/post/${
              record.uri.match(/app\.bsky\.feed\.post\/(\w+)/)?.at(1)
            }`,
          ),
          tag("guid", { isPermaLink: "false" }, record.uri),
          tag("pubDate", record.value.createdAt),
          tag("dc:creator", handle),
        )
      ),
    ),
  );
  return new Response(prefix + res, {
    headers: { "content-type": "application/xml" },
  });
});
