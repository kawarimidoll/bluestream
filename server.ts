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

//post
//reply.parent
function getPost(
  post: AtoprotoAPI.AppBskyFeedDefs.PostView,
  fullMedia = false,
) {
  const author = post.author;

  //don't forget to sanitise text into html entities so that it is rendered correctly
  //try not to sanitise urls tho
  const text = (AppBskyFeedPost.isRecord(post.record))
    ? processText(post.record)
    : "";

  //FIXME: its not including media in replies
  const media = (
      //if post with media
      AppBskyEmbedImages.isView(post.embed) &&
      AppBskyEmbedImages.isViewImage(post.embed.images)
    )
    ? post.embed.images
    : (
        //if post with media and Quoted post with media
        AppBskyEmbedRecordWithMedia.isView(post.embed) &&
        AppBskyEmbedImages.isView(post.embed.media)
      )
    ? post.embed.media.images
    : [];

  const mediastr = (media.length > 0)
    ? tag(
      "div",
      ...media.map((image) => {
       return tag("figure", `<img src="${
          fullMedia ? image.fullsize : image.thumb
        }"/><figcaption>${image.alt}</figcaption>`,"<br>");
      }),
    )
    : "";
   if(media.length > 0){console.log(post.uri, mediastr)}
  return {
    author: author,
    uri: post.uri,
    text: text,
    mediaarr: media,
    media: mediastr,
    quote: getQuotePost(post, fullMedia),
  };
}

//post
//reply.parent
function getQuotePost(
  post: AtoprotoAPI.AppBskyFeedDefs.PostView,
  fullMedia = false,
) {
  const quotePost = (
      //Text-only post with Quoted post with media
      AppBskyEmbedRecord.isView(post.embed) &&
      AppBskyEmbedRecord.isViewRecord(post.embed.record)
    )
    ? post.embed.record
    : (
        //Media post with quoted post with media
        AppBskyEmbedRecordWithMedia.isView(post.embed) &&
        AppBskyEmbedRecord.isView(post.embed.record) &&
        AppBskyEmbedRecord.isViewRecord(post.embed.record.record)
      )
    ? post.embed.record.record
    : undefined;

  if (quotePost) {
    const author = quotePost.author;
    const text = (AtoprotoAPI.AppBskyFeedPost.isRecord(quotePost.value))
      ? processText(quotePost.value)
      : "";

    const media: AtoprotoAPI.AppBskyEmbedImages.ViewImage[] = [];
    if (quotePost.embeds) {
      quotePost.embeds.forEach((embed) => {
        if (AppBskyEmbedImages.isView(embed)) {
          embed.images.forEach((image) => {
            if (AppBskyEmbedImages.isViewImage(image)) media.push(image);
          });
        }
      });
    }

    const mediastr = (media.length > 0)
      ? tag(
        "div",
        ...media.map((image) =>
          `<figure><img src="${
            fullMedia ? image.fullsize : image.thumb
          }"/><figcaption>${image.alt}</figcaption></figure>`
        ),
      )
      : "";

    return {
      uri: quotePost.uri,
      author: author,
      text: text,
      media: mediastr,
    };
  } else return undefined;
}

function processText(
  record: AtoprotoAPI.AppBskyFeedPost.Record,
) {
  interface facetLink {
    substr: string;
    uri: string;
  }
  let text = record.text;
  const arr: facetLink[] = [];
  if (record.facets) {
    record.facets.forEach((facet) => {
      const substr = text.substring(facet.index.byteStart, facet.index.byteEnd);
      const feature = facet.features.find((v) => {
        return AppBskyRichtextFacet.isLink(v);
      });
      if (AppBskyRichtextFacet.isLink(feature)) {
        arr.push({ substr: substr, uri: feature.uri });
      }
    });
  }

  text = sanitize(text).replace(/\n/g, "<br>");
  if (arr.length > 0) {
    arr.forEach((feature) => {
      text = text.replace(
        sanitize(feature.substr),
        `<a href="${feature.uri}">${sanitize(feature.substr)}</a>`,
      );
    });
  }
  return text;
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

//Repost by user1, original by user2
//Post by user1
//Post by user1, quoting user2
//Post by user1, reply to user2, quoting user3
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
  feed: AtoprotoAPI.AppBskyFeedDefs.FeedViewPost,
  usePsky: boolean,
  includeRepost: boolean,
  fullMedia: boolean,
  replyContext: boolean,
) {
  const post = getPost(feed.post, fullMedia);
  const reply = (AppBskyFeedDefs.isPostView(feed.reply?.parent))
    ? getPost(feed.reply.parent, fullMedia)
    : undefined;

  //used for embedded link preview (Eg for chats like discord / telegram)
  if (usePsky) {
    if (
      includeRepost &&
      post.quote
    ) {
      return ["[quote] ", uriToPostLink(post.quote.uri, usePsky)];
    }

    return [];
  }

  return [
    "<![CDATA[",
    post.media,
    tag("p", post.text),
    (post.quote)
      ? tag(
        "p",
        `<br>[quote]<br><b>${
          sanitize(post.quote.author.displayName || "")
        }</b> <i>@${post.quote.author.handle || "unknown"}</i> posted:<br>`,
        post.quote.media,
        tag("p", post.quote.text),
      )
      : "",
    (replyContext && reply)
      ? tag(
        "p",
        "<hr><hr>",
        //changed "posted" to the post type (posted / replied)
        `<b>${sanitize(reply.author.displayName || "")}</b> <i>@${
          reply.author.handle || "unknown"
        }</i> posted:<br>`,
        reply.media,
        tag("p", reply.text),
        (reply.quote)
          ? tag(
            "p",
            //changed "posted" to the post type (posted / replied)
            `<br>[quote]<br><b>${
              sanitize(reply.quote.author.displayName || "")
            }</b> <i>@${
              reply.quote.author.handle || "unknown"
            }</i> posted:<br>`,
            reply.quote.media,
            tag("p", reply.quote.text),
          )
          : "",
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

Deno.serve(async (request: Request) => {
  const { href, pathname, searchParams } = new URL(request.url);
  if (IS_DEV) {
    console.log(pathname);
  }
  // const aaa = await agent.api.app.bsky.feed.getPosts({uris: ["at://did:plc:bw35mx7zohkm3fmtxtixidbz/app.bsky.feed.post/3ki7ijwwybo2d", "at://did:plc:bw35mx7zohkm3fmtxtixidbz/app.bsky.feed.post/3ki7ir64mo22m"]});

  // return new Response (JSON.stringify(aaa));

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

  // return new Response(JSON.stringify(authorFeed), {headers: { "content-type": "application/json" },});

  const usePsky = searchParams.get("link") === "psky";
  const includeRepost = searchParams.get("repost") === "include";
  const replyContext = searchParams.get("reply-context") === "include";
  const excludeReply = searchParams.get("reply") === "exclude";
  const excludeMention = searchParams.get("mention") === "exclude";
  const fullMedia = searchParams.get("media") === "full";

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
          tag(
            "description",
            ...genMainContent(
              { post, reason, reply },
              usePsky,
              includeRepost,
              fullMedia,
              replyContext,
            ),
          ),
          ...getPost(post).mediaarr.map((image) =>
            `<enclosure type="image/jpeg" length="0" url="${
              fullMedia ? image.fullsize : image.thumb
            }"/>`
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
