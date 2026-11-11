import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { savedSave } from "../../../../saves";

// a player's uploaded save, as the zip TapTap's cloud would give
export default defineHandler((event) => {
  const save = savedSave(getRouterParam(event, "id")!);
  if (!save) throw HTTPError.status(404);
  return new Response(save.zip, {
    headers: {
      "content-type": "application/zip",
      "last-modified": new Date(save.updated).toUTCString(),
    },
  });
});
