import { serve } from "https://deno.land/std@0.140.0/http/server.ts";
import {
  sanitize,
  tagNoVoid as tag,
} from "https://deno.land/x/markup_tag@0.4.0/mod.ts";

import BskyAgent from "https://esm.sh/@atproto/api@0.2.7";

const isDev = !Deno.env.get("DENO_DEPLOYMENT_ID");

if (isDev) {
  const env = await Deno.readTextFile("./.env");
  env.split("\n").forEach((line) => {
    if (line) {
      const [key, val] = line.split("=");
      Deno.env.set(key, val);
    }
  });
}

const service = "https://bsky.social";
const agent = new BskyAgent({ service });

const identifier = Deno.env.get("BLUESKY_IDENTIFIER") || "";
const password = Deno.env.get("BLUESKY_PASSWORD") || "";
await agent.login({ identifier, password });

function getDidFromUri(uri: string) {
  return uri.replace(/^at:\/\//, "").replace(
    /\/app\.bsky\.feed.*$/,
    "",
  );
}
function uriToPostLink(uri: string) {
  return `https://staging.bsky.app/profile/${
    uri.replace(/^at:\/\//, "").replace(
      /app\.bsky\.feed\./,
      "",
    )
  }`;
}

interface ProfileViewDetailed {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  indexedAt?: string;
  [k: string]: unknown;
}
const actors: Record<string, ProfileViewDetailed> = {};

async function getActor(handleOrDid: string): Promise<ProfileViewDetailed> {
  try {
    const did = handleOrDid.startsWith("did:plc:")
      ? handleOrDid
      : (await agent.resolveHandle({ handle: handleOrDid })).data.did;

    if (actors[did]) {
      return actors[did];
    }

    const { data } = await agent.api.app.bsky.actor.getProfile({ actor: did });
    actors[did] = data;
    return data;
  } catch (error) {
    console.error(handleOrDid);
    console.error(error);
    return { did: "", handle: "" };
  }
}

serve(async (request: Request) => {
  const { href, pathname, searchParams } = new URL(request.url);
  if (isDev) {
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

  const { did, handle } = await getActor(pathname.replace(/^\//, ""));
  if (did === "") {
    return new Response("Unable to resolve handle", {
      headers: { "content-type": "text/plain" },
    });
  }

  const authorFeed = await agent.api.app.bsky.feed.getAuthorFeed({
    actor: did,
  });
  if (!authorFeed?.data?.feed) {
    return new Response("Unable to get posts", {
      headers: { "content-type": "text/plain" },
    });
  }
  const includeRepost = searchParams.get("repost") === "include";
  // const includeReply = searchParams.get("reply") === 'include';
  const feeds = authorFeed.data.feed.filter(({ post }) => {
    if (!includeRepost && post.author.did !== did) return false;
    // if (!includeReply && !!post.record.reply) return false;
    return true;
  });
  for await (const feed of feeds) {
    if (!feed.post.record.reply) {
      continue;
    }
    await getActor(
      getDidFromUri(feed.post.record.reply.parent.uri),
    );
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
      tag("link", `https://staging.bsky.app/profile/${did}`),
      tag("description", `${handle}'s posts in ${service}`),
      tag("lastBuildDate", feeds.at(0)?.post.record.createdAt || ""),
      ...feeds.map(({ post }) =>
        tag(
          "item",
          tag(
            "title",
            post.author.did !== did
              ? `Repost original by ${post.author.handle}`
              : post.record.reply
              ? `Reply to ${
                actors[getDidFromUri(post.record.reply.parent.uri)].handle
              }`
              : `Post by ${handle}`,
          ),
          tag(
            "description",
            "<![CDATA[<p>" + sanitize(post.record.text).replace(/\n/, "<br>") +
              "</p>]]>",
          ),
          tag("link", uriToPostLink(post.uri)),
          tag("guid", { isPermaLink: "false" }, post.uri),
          tag("pubDate", post.record.createdAt),
          tag("dc:creator", post.author.handle),
        )
      ),
    ),
  );
  return new Response(prefix + res, {
    headers: { "content-type": "application/xml" },
  });
});
