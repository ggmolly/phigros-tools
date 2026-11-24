import { defineHandler } from "nitro/h3";
import { queueCatalog } from "../../queue";

// asks for the mod catalog to be read again now, which a mod's author does once its release is out
export default defineHandler(async () => {
  await queueCatalog();
  return new Response(null, { status: 204 });
});
