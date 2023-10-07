import { login } from "./login.ts";
import { BLUESKY_SERVICE, IS_DEV } from "./constants.ts";
import { toUTCString, uriToPostLink } from "./utils.ts";

import { sanitize, tagNoVoid as tag } from "markup_tag";

import AtoprotoAPI, { AppBskyActorDefs } from "@atproto/api";
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
} = AtoprotoAPI;

const agent = await login();

function getEmbedImages(post: AtoprotoAPI.AppBskyFeedDefs.PostView) {
  return AppBskyEmbedImages.isView(post.embed) ? post.embed.images : [];
}

// $typeが含まれていないので正常に判定できないものを自前実装
// deno-lint-ignore no-explicit-any
function isReplyRef(v: any): v is AtoprotoAPI.AppBskyFeedPost.ReplyRef {
  return !!v && typeof v === "object" && Object.hasOwn(v, "root") &&
    AppBskyFeedDefs.isPostView(v.root) && Object.hasOwn(v, "parent") &&
    AppBskyFeedDefs.isPostView(v.parent);
}
function isProfileViewBasic(
  v: unknown,
): v is AtoprotoAPI.AppBskyActorDefs.ProfileViewBasic {
  return !!v && typeof v === "object" && Object.hasOwn(v, "did") &&
    Object.hasOwn(v, "handle");
}

function genTitle(
  author: AppBskyActorDefs.ProfileViewDetailed,
  feed: AtoprotoAPI.AppBskyFeedDefs.FeedViewPost,
) {
  const { handle } = author;
  const { post, reason, reply } = feed;
  if (AppBskyFeedDefs.isReasonRepost(reason)) {
    return `Repost by ${handle}, original by ${
      post.author.handle || "unknown"
    }`;
  }
  let title = `Post by ${handle}`;
  if (isReplyRef(reply) && isProfileViewBasic(reply.parent.author)) {
    title = `${title}, reply to ${reply.parent.author.handle || "unknown"}`;
  }
  if (post.embed) {
    if (AppBskyEmbedRecord.isViewRecord(post.embed.record)) {
      title = `${title}, quoting ${
        post.embed.record.author.handle || "unknown"
      }`;
    } else if (
      AppBskyEmbedRecordWithMedia.isView(post.embed) &&
      AppBskyEmbedRecord.isViewRecord(post.embed.record.record)
    ) {
      // NOTE: checking viewRecord may need here
      title = `${title}, quoting ${
        post.embed.record.record.author.handle || "unknown"
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
  /* MAR: NO DIV tag */
  const imagesDiv = "";
  /*
  const imagesDiv = embedImages.length
    ? tag("div", ...embedImages.map((image) => `<img src="${image.thumb}"/>`))
    : "";
  */
  return [
    /* MAR: delete P tag */
    "<![CDATA[",
    imagesDiv,
    sanitize(post.record.text),
    (
      AppBskyEmbedRecord.isView(post.embed) &&
      AppBskyEmbedRecord.isViewRecord(post.embed.record) &&
      AppBskyFeedPost.isRecord(post.embed.record.value)
    )
      ? "\n[quote] " + sanitize(post.embed.record.value.text || "unknown")
      : "",
    /*
    tag("p", sanitize(post.record.text).replace(/\n/g, "<br>")),
    (
      AppBskyEmbedRecord.isView(post.embed) &&
      AppBskyEmbedRecord.isViewRecord(post.embed.record) &&
      AppBskyFeedPost.isRecord(post.embed.record.value)
    )
      ? tag(
        "p",
        "<br>[quote]<br>",
        sanitize(post.embed.record.value.text || "unknown"),
      )
      : "",
      */
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

Deno.serve(async (request: Request) => {
  const { href, pathname, searchParams } = new URL(request.url);
  if (IS_DEV) {
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
    if (excludeReply && record.reply) return false;
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
      tag("description", `${handle}'s posts in ${BLUESKY_SERVICE}`),
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
