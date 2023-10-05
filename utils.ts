export function toUTCString(dateString?: string) {
  if (!dateString) {
    return "";
  }
  return (new Date(dateString)).toUTCString();
}

export function getDidFromUri(uri: string) {
  return uri.replace(/^at:\/\//, "").replace(
    /\/app\.bsky\.feed.*$/,
    "",
  );
}

export function uriToPostLink(uri: string, usePsky: boolean) {
  const origin = usePsky ? "psky.app" : "bsky.app";
  return `https://${origin}/profile/${
    uri.replace(/^at:\/\//, "").replace(
      /app\.bsky\.feed\./,
      "",
    )
  }`;
}
