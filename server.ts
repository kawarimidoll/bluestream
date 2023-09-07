import { serve } from "https://deno.land/std@0.200.0/http/server.ts";
import {
  sanitize,
  tagNoVoid as tag,
} from "https://deno.land/x/markup_tag@0.4.0/mod.ts";

import AtoprotoAPI, { AppBskyActorDefs } from "npm:@atproto/api@0.6.10";
const {
  // AppBskyActorDefsをimportしていても一部でcannot find namespaceエラーが出る
  // したがってエラーが出る箇所はAtoprotoAPI.AppBskyFeedDefsを使用する
  // なぜかは不明
  AppBskyFeedDefs,
  AppBskyEmbedImages,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyFeedPost,
  AppBskyRichtextFacet,
  BskyAgent,
} = AtoprotoAPI;

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

function toUTCString(dateString?: string) {
  if (!dateString) {
    return "";
  }
  return (new Date(dateString)).toUTCString();
}
function getDidFromUri(uri: string) {
  return uri.replace(/^at:\/\//, "").replace(
    /\/app\.bsky\.feed.*$/,
    "",
  );
}
function uriToPostLink(uri: string, usePsky: boolean) {
  const origin = usePsky ? "psky.app" : "bsky.app";
  return `https://${origin}/profile/${
    uri.replace(/^at:\/\//, "").replace(
      /app\.bsky\.feed\./,
      "",
    )
  }`;
}
function getEmbedImages(post: AtoprotoAPI.AppBskyFeedDefs.PostView) {
  return AppBskyEmbedImages.isView(post.embed) ? post.embed.images : [];
}
function genTitle(
  author: AppBskyActorDefs.ProfileViewDetailed,
  feed: AtoprotoAPI.AppBskyFeedDefs.FeedViewPost,
) {
  const { handle } = author;
  const { post, reason, reply } = feed;
  if (AppBskyFeedDefs.isReasonRepost(reason)) {
    return `Repost by ${handle}, original by ${
      post.author?.handle || "unknown"
    }`;
  }
  let title = `Post by ${handle}`;
  if (AppBskyFeedPost.isReplyRef(reply)) {
    title = `${title}, reply to ${
      actors[getDidFromUri(reply.parent.uri)].handle
    }`;
  }
  if (post.embed) {
    if (AppBskyEmbedRecord.isViewRecord(post.embed.record)) {
      title = `${title}, quoting ${
        post.embed.record!.author?.handle || "unknown"
      }`;
    } else if (
      AppBskyEmbedRecordWithMedia.isView(post.embed) &&
      AppBskyEmbedRecord.isViewRecord(post.embed.record.record)
    ) {
      // NOTE: checking viewRecord may need here
      title = `${title}, quoting ${
        post.embed.record!.record!.author?.handle || "unknown"
      }`;
    }
  }
  return title;
}
function genMainContent(
  post: AtoprotoAPI.AppBskyFeedDefs.PostView,
  usePsky: boolean,
  includeRepost: boolean,
) {
  if (usePsky) {
    if (
      includeRepost &&
      AppBskyEmbedRecord.isView(post.embed) &&
      AppBskyEmbedRecord.isViewRecord(post.embed.record)
    ) {
      return ["[quote] ", uriToPostLink(post.embed.record.uri, usePsky)];
    } else if (
      AppBskyEmbedRecordWithMedia.isView(post.embed) &&
      AppBskyEmbedRecord.isViewRecord(post.embed.record.record)
    ) {
      return ["[quote] ", uriToPostLink(post.embed.record.record.uri, usePsky)];
    }

    return [];
  }

  if (!AppBskyFeedPost.isRecord(post.record)) {
    return [];
  }

  const embedImages = getEmbedImages(post);
  const imagesDiv = embedImages.length
    ? tag("div", ...embedImages.map((image) => `<img src="${image.thumb}"/>`))
    : "";

  return [
    "<![CDATA[",
    imagesDiv,
    tag("p", sanitize(post.record.text).replace(/\n/g, "<br>")),
    (
        AppBskyEmbedRecord.isView(post.embed) &&
        AppBskyEmbedRecord.isViewRecord(post.embed.record) &&
        AppBskyFeedPost.isRecord(post.embed.record.value)
      )
      ? tag(
        "p",
        "<br>[quote]<br>",
        sanitize(post.embed.record!.value?.text || "unknown"),
      )
      : "",
    "]]>",
  ];
}

const actors: Record<string, AppBskyActorDefs.ProfileViewDetailed> = {};

async function getActor(
  handleOrDid: string,
): Promise<AppBskyActorDefs.ProfileViewDetailed> {
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

  const response = await agent.api.app.bsky.feed.getAuthorFeed({
    actor: did,
  });
  if (!response?.data?.feed) {
    return new Response("Unable to get posts", {
      headers: { "content-type": "text/plain" },
    });
  }
  const authorFeed: AtoprotoAPI.AppBskyFeedDefs.FeedViewPost[] =
    response.data.feed;

  const usePsky = searchParams.get("link") === "psky";
  const includeRepost = searchParams.get("repost") === "include";
  const excludeReply = searchParams.get("reply") === "exclude";
  const excludeMention = searchParams.get("mention") === "exclude";

  const feeds = authorFeed.filter(({ post, reason }) => {
    if (!includeRepost && AppBskyFeedDefs.isReasonRepost(reason)) {
      return false;
    }
    if (!AppBskyFeedPost.isRecord(post.record)) {
      return false;
    }
    const record = post.record;
    if (excludeReply && !!record?.reply) return false;
    if (
      excludeMention &&
      (record?.facets || []).some((facet) =>
        (facet.features || []).some((feature) =>
          AppBskyRichtextFacet.isMention(feature)
        )
      )
    ) return false;
    return true;
  });
  for await (const feed of feeds) {
    if (AppBskyFeedPost.isReplyRef(feed.reply)) {
      // store actors
      await getActor(getDidFromUri(feed.reply.parent.uri));
    }
  }

  const firstPost = feeds.at(0)?.post;

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
      tag("link", `https://bsky.app/profile/${did}`),
      tag("description", `${handle}'s posts in ${service}`),
      AppBskyFeedDefs.isPostView(firstPost) &&
        AppBskyFeedPost.isRecord(firstPost.record)
        ? tag("lastBuildDate", toUTCString(firstPost.record.createdAt))
        : "",
      ...feeds.map(({ post, reason, reply }) =>
        tag(
          "item",
          tag("title", genTitle({ did, handle }, { post, reason, reply })),
          tag("description", ...genMainContent(post, usePsky, includeRepost)),
          ...getEmbedImages(post).map((image) =>
            `<enclosure type="image/jpeg" length="0" url="${image.thumb}"/>`
          ).join(""),
          tag("link", uriToPostLink(post.uri, usePsky)),
          tag(
            "guid",
            { isPermaLink: "false" },
            post.uri +
              (AppBskyFeedDefs.isReasonRepost(reason) ? "-repost" : ""),
          ),
          AppBskyFeedPost.isRecord(post.record)
            ? tag("pubDate", toUTCString(post.record.createdAt))
            : "",
          tag("dc:creator", post.author.handle),
        )
      ),
    ),
  );
  return new Response(prefix + res, {
    headers: { "content-type": "application/xml" },
  });
});
