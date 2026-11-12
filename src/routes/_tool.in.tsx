import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { message, useSave } from "../save-context";

export const Route = createFileRoute("/_tool/in")({
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: SignInLink,
});

// Phigros++'s Open in browser lands here with its code after the #, which never reaches the server
function SignInLink() {
  const { signIn, storageReady } = useSave();
  const navigate = useNavigate();
  const t = useT();
  const [error, setError] = useState("");
  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once storage is ready; signIn and navigate aren't wrapped in useCallback (the React Compiler handles memoisation).
  useEffect(() => {
    if (!storageReady || started.current) return;
    started.current = true;
    const code = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
    signIn({ code }).then(
      () => navigate({ to: "/", replace: true }),
      (e) => setError(message(e)),
    );
  }, [storageReady]);
  return (
    <section className="panel" role="status">
      <p className={error ? "negative" : "meta"}>{error || t.ppp.signingInFromLink}</p>
    </section>
  );
}
