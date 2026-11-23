import { defineHandler } from "nitro/h3";
import { allowed, state } from "../../../admin";

// what the server holds right now, for /admin
export default defineHandler(async (event) => {
  await allowed(event);
  return state();
});
