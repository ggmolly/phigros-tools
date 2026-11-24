import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getDocs } from "../docs";

// docs.phigros.tools (router.tsx): the pages of the Phigros++ wiki and its Mod API, built by scripts/build-docs.ts
export const Route = createFileRoute("/docs")({
  loader: () => getDocs(),
  staleTime: Number.POSITIVE_INFINITY,
  component: Outlet,
});
