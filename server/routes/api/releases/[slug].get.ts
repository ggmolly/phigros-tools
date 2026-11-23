import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { notes } from "../../../releases";

// a release note with what it says
export default defineHandler(async (event) => {
  const note = (await notes()).find(({ slug }) => slug === getRouterParam(event, "slug"));
  if (!note) throw HTTPError.status(404);
  return note;
});
