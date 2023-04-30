import { serve } from "https://deno.land/std@0.184.0/http/server.ts";
import {
  sanitize,
  tagNoVoid as tag,
} from "https://deno.land/x/markup_tag@0.4.0/mod.ts";

import BskyAgent, {
  AppBskyActorDefs,
  AppBskyFeedDefs,
} from "https://esm.sh/@atproto/api@0.2.10";
type ProfileViewDetailed = AppBskyActorDefs.ProfileViewDetailed;
type FeedViewPost = AppBskyFeedDefs.FeedViewPost;
type PostView = AppBskyFeedDefs.PostView;

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
function uriToPostLink(uri: string, usePsky: boolean) {
  const origin = usePsky ? "psky.app" : "staging.bsky.app";
  return `https://${origin}/profile/${
    uri.replace(/^at:\/\//, "").replace(
      /app\.bsky\.feed\./,
      "",
    )
  }`;
}
function genTitle(author: ProfileViewDetailed, feed: FeedViewPost) {
  const { handle } = author;
  const { post, reason, reply } = feed;
  if (reason && reason["$type"] === BSKY_TYPES.repost) {
    return `Repost by ${handle}, original by ${post.author.handle}`;
  }
  let title = `Post by ${handle}`;
  if (reply) {
    title = `${title}, reply to ${
      actors[getDidFromUri(reply.parent.uri)].handle
    }`;
  }
  if (post.embed && post.embed["$type"] === BSKY_TYPES.view) {
    title = `${title}, quoting ${post.embed.record!.author.handle}`;
  } else if (post.embed && post.embed["$type"] === BSKY_TYPES.recordWithMedia) {
    title = `${title}, quoting ${post.embed.record!.record!.author.handle}`;
  }
  return title;
}
function genMainContent(
  post: PostView,
  usePsky: boolean,
  includeRepost: boolean,
) {
  if (usePsky) {
    if (
      includeRepost && post.embed && post.embed["$type"] === BSKY_TYPES.view
    ) {
      return ["[quote] ", uriToPostLink(post.embed.record.uri, usePsky)];
    } else if (
      post.embed && post.embed["$type"] === BSKY_TYPES.recordWithMedia
    ) {
      return ["[quote] ", uriToPostLink(post.embed.record.record.uri, usePsky)];
    }

    return [];
  }
  return [
    "<![CDATA[",
    tag(
      "div",
      ...(post.embed?.images || []).map((image) =>
        `<img src="${image.thumb}"/>`
      ),
    ),
    tag("p", sanitize(post.record.text).replace(/\n/, "<br>")),
    (post.embed && post.embed["$type"] === BSKY_TYPES.view)
      ? tag("p", "<br>[quote]<br>", sanitize(post.embed.record!.value.text))
      : "",
    "]]>",
  ];
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

const BSKY_TYPES = {
  repost: "app.bsky.feed.defs#reasonRepost",
  view: "app.bsky.embed.record#view",
  recordWithMedia: "app.bsky.embed.recordWithMedia#view",
};
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
  const usePsky = searchParams.get("link") === "psky";
  const includeRepost = searchParams.get("repost") === "include";
  // const includeReply = searchParams.get("reply") === 'include';
  const feeds = authorFeed.data.feed.filter(({ reason }) => {
    if (!includeRepost && reason && reason["$type"] === BSKY_TYPES.repost) {
      return false;
    }
    // if (!includeReply && !!post.record.reply) return false;
    return true;
  });
  for await (const feed of feeds) {
    if (!feed.reply) {
      continue;
    }
    // store actors
    await getActor(
      getDidFromUri(feed.reply.parent.uri),
    );
  }

  const prefix = '<?xml version="1.0" encoding="UTF-8"?>';
  const res = tag(
    "rss",
    {
      version: "2.0",
      "xmlns:content": "http://purl.org/rss/1.0/modules/content/",
      "xmlns:atom": "http://www.w3.org/2005/Atom",
      "xmlns:dc": "http://purl.org/dc/elements/1.1/",
    },
    tag(
      "channel",
      tag("title", `Bluestream (${handle})`),
      `<atom:link href="${
        sanitize(href)
      }" rel="self" type="application/rss+xml" />`,
      tag("link", `https://staging.bsky.app/profile/${did}`),
      tag("description", `${handle}'s posts in ${service}`),
      tag("lastBuildDate", feeds.at(0)?.post.record.createdAt || ""),
      ...feeds.map(({ post, reason }) =>
        tag(
          "item",
          tag("title", genTitle({ did, handle }, { post, reason })),
          tag("description", ...genMainContent(post, usePsky, includeRepost)),
          ...(post.embed?.images || []).map((image) =>
            `<enclosure type="image/jpeg" length="0" url="${image.thumb}"/>`
          ).join(""),
          tag("link", uriToPostLink(post.uri, usePsky)),
          tag(
            "guid",
            { isPermaLink: "false" },
            post.uri +
              (reason && reason["$type"] === BSKY_TYPES.repost
                ? "-repost"
                : ""),
          ),
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
