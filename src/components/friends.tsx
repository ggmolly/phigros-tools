import { useEffect, useState } from "react";
import { catalogSong } from "../catalog";
import type { Friendship } from "../friends";
import { useT } from "../i18n";
import type { PlayerName } from "../plays";
import { message, useSave } from "../save-context";
import type { Credential } from "../store";
import { Arrow } from "./arrow";
import { PlayerTag } from "./plays";

const POLL = 15_000; // who is online changes without the page asking: an open page reads the list again this often
// the requests to answer first, then the friends who are online, the others, and the requests sent
const ORDER = { incoming: 0, friend: 1, outgoing: 3 };
const place = (f: Friendship) => ORDER[f.state] + (f.state === "friend" && !f.online ? 1 : 0);

/** The signed-in profile's friends while a page shows them, and what changes them (src/friends.ts). */
export function useFriends(credential: Credential | undefined) {
  const { say } = useSave();
  const [friends, setFriends] = useState<Friendship[]>();
  const signer = credential?.signer;
  const fail = (e: unknown) => say(`✗ ${message(e)}`);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads again per profile, not per render (say and the signer are that profile's).
  useEffect(() => {
    if (!signer) return;
    // a read that fails later leaves the list as it was
    const load = (told: (e: unknown) => void) =>
      import("../friends").then((api) => api.listFriends(signer)).then(setFriends, told);
    void load(fail);
    const timer = setInterval(() => void load(() => undefined), POLL);
    return () => clearInterval(timer);
  }, [credential?.playerId]);
  const change = (act: "addFriend" | "removeFriend") => (player: string) => {
    if (signer)
      void import("../friends").then((api) => api[act](signer, player)).then(setFriends, fail);
  };
  return { friends, add: change("addFriend"), remove: change("removeFriend") };
}

type Friends = ReturnType<typeof useFriends>;

/** What a friendship says: a request's way, or whether the friend is online and what they play. */
function Status({ friendship: { state, online, playing } }: { friendship: Friendship }) {
  const t = useT();
  if (state !== "friend") return state === "incoming" ? t.friends.incoming : t.friends.outgoing;
  if (!online) return t.friends.offline;
  if (!playing) return <b className="status status-verified">{t.friends.online}</b>;
  const title = catalogSong(playing.id.replace(/\.0$/, ""))?.title ?? playing.id;
  return <b className="status status-verified">{t.friends.playing(`${title} ${playing.level}`)}</b>;
}

/** What can be done about a player: accept or decline their request, take one back, or remove a friend. */
function Actions({
  friendship,
  add,
  remove,
}: { friendship: Friendship } & Omit<Friends, "friends">) {
  const t = useT();
  const { player, state } = friendship;
  if (state === "incoming")
    return (
      <>
        <button type="button" className="btn" onClick={() => add(player.id)}>
          {t.friends.accept}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => remove(player.id)}>
          {t.friends.decline}
        </button>
      </>
    );
  return state === "outgoing" ? (
    <button type="button" className="btn btn-ghost" onClick={() => remove(player.id)}>
      {t.friends.takeBack}
    </button>
  ) : (
    <button
      type="button"
      className="btn btn-ghost btn-danger"
      onClick={() => confirm(t.friends.removeConfirm(player.name)) && remove(player.id)}
    >
      {t.friends.remove}
    </button>
  );
}

/** The signed-in profile's friends and requests, with a field to add one by name and number. */
export function FriendsPanel({ credential }: { credential: Credential }) {
  const { home } = useSave();
  const t = useT();
  const { friends, add, remove } = useFriends(credential);
  const [typed, setTyped] = useState("");
  const me = home?.profile.player;
  return (
    <section className="panel" aria-labelledby="friends-heading">
      <div className="panel-head devices-head">
        <h2 id="friends-heading" className="panel-title">
          {t.tabs.friends}
        </h2>
        <form
          className="friend-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (!typed.trim()) return;
            add(typed);
            setTyped("");
          }}
        >
          <input
            className="field"
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
            placeholder="Name#0042"
            aria-label={t.friends.add}
            maxLength={64}
          />
          <button type="submit" className="btn">
            {t.friends.add} <Arrow />
          </button>
        </form>
      </div>
      {me && (
        <p className="meta">
          {t.friends.yours(`${me.name}#${String(me.number).padStart(4, "0")}`)}
        </p>
      )}
      {friends?.length === 0 && <p className="meta">{t.friends.empty}</p>}
      <ul className="device-list">
        {friends
          ?.toSorted((a, b) => place(a) - place(b))
          .map((friendship) => (
            <li key={friendship.player.id}>
              <span className="device-text">
                <PlayerTag player={friendship.player} />
                <span className="meta">
                  <Status friendship={friendship} />
                </span>
              </span>
              <Actions friendship={friendship} add={add} remove={remove} />
            </li>
          ))}
      </ul>
    </section>
  );
}

/** On another player's page: asks them to be a friend, or says what they already are with what can be done about it. */
export function FriendBar({ credential, player }: { credential: Credential; player: PlayerName }) {
  const t = useT();
  const { friends, add, remove } = useFriends(credential);
  if (!friends) return null;
  const friendship = friends.find((each) => each.player.id === player.id);
  return (
    <div className="friend-bar">
      {friendship ? (
        <>
          <span className="meta">
            {friendship.state === "friend" ? t.friends.friend : <Status friendship={friendship} />}
          </span>
          <Actions friendship={friendship} add={add} remove={remove} />
        </>
      ) : (
        <button type="button" className="btn" onClick={() => add(player.id)}>
          {t.friends.addFriend} <Arrow />
        </button>
      )}
    </div>
  );
}
