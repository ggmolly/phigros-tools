import { Fragment, type ReactNode, useEffect, useState } from "react";
import { useFormat, useT } from "../i18n";
import type { Bytes, Report, Tell } from "../ipa";
import { opened } from "../release";
import { Arrow } from "./arrow";

interface Pack {
  data: Bytes;
  version: string;
  games: string[];
}
interface Run {
  file: File;
  report: Partial<Report>;
  log: { at: number; line: string }[];
  error?: string;
  url?: string;
}

const hex = (n: number) => `0x${n.toString(16)}`;

/** The store's artwork at an icon's size with the ++ tab, drawn as mod/scripts/patch_apk.py draws android's. */
async function icon(artwork: Bytes, size: number): Promise<Bytes> {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d")!;
  const resized = { resizeWidth: size, resizeHeight: size, resizeQuality: "high" } as const;
  context.drawImage(await createImageBitmap(new Blob([artwork]), resized), 0, 0);
  // the tab in its own units: 60 wide, 40 high, leaning 12, a + at x 23 and 42, over a shadow
  const k = (0.52 * size) / 60;
  const [x, y] = [0.94 * size - 60 * k, 0.94 * size - 40 * k];
  for (const [shift, color] of [
    [0.02 * size, "rgb(0 0 0 / 0.5)"],
    [0, "#f4f2f6"],
  ] as const) {
    context.fillStyle = color;
    context.beginPath();
    for (const [px, py] of [
      [12, 0],
      [60, 0],
      [48, 40],
      [0, 40],
    ])
      context.lineTo(x + shift + px * k, y + shift + py * k);
    context.fill();
  }
  context.fillStyle = "#0d0a0e";
  for (const plus of [23, 42]) {
    context.fillRect(x + (plus - 8) * k, y + 17.5 * k, 16 * k, 5 * k);
    context.fillRect(x + (plus - 2.5) * k, y + 12 * k, 5 * k, 16 * k);
  }
  return new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
}

function Facts({ rows }: { rows: [name: string, value: ReactNode][] }) {
  return (
    <dl>
      {rows.map(
        ([name, value]) =>
          value && (
            <Fragment key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </Fragment>
          ),
      )}
    </dl>
  );
}

/** A table that scrolls in its own box, which takes the focus so the keyboard scrolls it too. */
function Table({ name, rows }: { name: string; rows: (string | number)[][] }) {
  const [head, ...body] = rows;
  // biome-ignore-start lint/suspicious/noArrayIndexKey: the rows never reorder.
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls is reached by the keyboard.
    <section className="patcher-scroll" aria-label={name} tabIndex={0}>
      <table>
        <thead>
          <tr>
            {head.map((title) => (
              <th key={title}>{title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={head[column]}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
  // biome-ignore-end lint/suspicious/noArrayIndexKey: the rows never reorder.
}

/** What the patcher found so far. It's said in the patcher's own words, the same in every language. */
function Found({ run: { file, log, report: r } }: { run: Run }) {
  const { number } = useFormat();
  const stubbed = r.hooks?.filter(({ stub }) => stub) ?? [];
  // what Phigros++ adds to a segment, at its start and at its end
  const added: Record<string, [start?: string | false, end?: string | false]> = {
    __TEXT: [
      r.load !== undefined && `LC_LOAD_DYLIB at ${hex(r.load)}`,
      r.stubs && `stubs from ${hex(r.stubs[0])}`,
    ],
    __DATA: [false, r.slots && `slots from ${hex(r.slots[0])}`],
  };
  return (
    <div className="patcher-found">
      <section>
        <h3>IPA</h3>
        <Facts
          rows={[
            ["file", `${file.name}, ${number(file.size)} bytes`],
            ["phigros++", r.version && `${r.version}, signed by the release key`],
            ["game", r.game && `Phigros ${r.game}, with a library for ${r.games?.join(", ")}`],
            ["entries", r.entries && number(r.entries)],
            ["output", r.size && `Phigros++.ipa, ${number(r.size)} bytes`],
          ]}
        />
        {r.dropped && (
          <details>
            <summary>{r.dropped.length} entries left out</summary>
            <ul>
              {r.dropped.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {r.segments && (
        <section>
          <h3>UnityFramework</h3>
          <Facts
            rows={[
              ["cryptid", `${r.cryptid} (${r.cryptid ? "encrypted" : "decrypted"})`],
              [
                "LC_LOAD_DYLIB",
                r.load !== undefined &&
                  `@executable_path/Frameworks/libphigrospp.dylib at ${hex(r.load)}`,
              ],
            ]}
          />
          <div className="patcher-map">
            {r.segments.map(({ name, vmaddr, vmsize }) => (
              <div
                key={name}
                style={{ flexGrow: vmsize }}
                data-start={added[name]?.[0] || undefined}
                data-end={added[name]?.[1] || undefined}
                title={[`${name} ${hex(vmaddr)} to ${hex(vmaddr + vmsize)}`, ...(added[name] ?? [])]
                  .filter(Boolean)
                  .join(", ")}
              >
                <span>{name}</span>
              </div>
            ))}
          </div>
          <Table
            name="segments"
            rows={[
              [
                "segment",
                "vmaddr",
                "vmsize",
                "fileoff",
                "filesize",
                "sections",
                "chained pointers",
              ],
              ...r.segments.map((segment) => [
                segment.name,
                hex(segment.vmaddr),
                hex(segment.vmsize),
                hex(segment.fileoff),
                hex(segment.filesize),
                segment.sections.length,
                segment.format ? `format ${segment.format}, ${segment.pages} pages` : "none",
              ]),
            ]}
          />
          <details>
            <summary>
              {r.segments.reduce((sum, { sections }) => sum + sections.length, 0)} sections
            </summary>
            <Table
              name="sections"
              rows={[
                ["section", "segment", "addr", "size", "offset"],
                ...r.segments.flatMap((segment) =>
                  segment.sections.map(({ name, addr, size, offset }) => [
                    name,
                    segment.name,
                    hex(addr),
                    hex(size),
                    hex(offset),
                  ]),
                ),
              ]}
            />
          </details>
        </section>
      )}
      {r.modules && (
        <section>
          <h3>il2cpp</h3>
          <Facts
            rows={[
              [
                "global-metadata.dat",
                `version ${r.metadata}, ${number(r.types ?? 0)} types in ${r.modules.length} images`,
              ],
              ["Il2CppCodeRegistration", hex(r.codeRegistration ?? 0)],
              ["Il2CppMetadataRegistration", hex(r.metadataRegistration ?? 0)],
              ["methods", r.methods && `${number(r.methods)} with code`],
            ]}
          />
          <Table
            name="Il2CppCodeGenModule"
            rows={[
              ["Il2CppCodeGenModule", "at", "methods"],
              ...r.modules.map(({ name, at, methods }) => [name, hex(at), number(methods)]),
            ]}
          />
        </section>
      )}
      {r.hooks && r.stubs && r.slots && (
        <section>
          <h3>Hooks</h3>
          <Facts
            rows={[
              ["without JIT", `${stubbed.length} methods`],
              [
                "with JIT only",
                r.hooks.length > stubbed.length &&
                  `${r.hooks.length - stubbed.length}, whose first instruction can't move`,
              ],
              [
                "stubs",
                `${hex(r.stubs[0])} to ${hex(r.stubs[1])}, ${stubbed.length} of the ${Math.floor((r.stubs[2] - r.stubs[0]) / 24)} that fit`,
              ],
              ["slots", `${hex(r.slots[0])} to ${hex(r.slots[1])}`],
            ]}
          />
          <div className="patcher-stubs" aria-hidden="true">
            {Array.from({ length: Math.floor((r.stubs[2] - r.stubs[0]) / 24) }, (_, i) => i).map(
              (i) => (
                <i
                  key={i}
                  data-used={i < stubbed.length || undefined}
                  title={stubbed[i] && `${hex(stubbed[i].stub)} ${stubbed[i].name}`}
                />
              ),
            )}
          </div>
          <Table
            name="hooks"
            rows={[
              ["at", "stub", "slot", "method"],
              ...r.hooks.map(({ name, at, stub, slot }) => [
                hex(at),
                stub ? hex(stub) : "JIT only",
                stub ? hex(slot) : "",
                name,
              ]),
            ]}
          />
        </section>
      )}
      <section>
        <h3>Log</h3>
        <ol>
          {log.map(({ at, line }, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a line only ever comes after the others.
            <li key={i}>
              <time>{(at / 1000).toFixed(3)} s</time>
              <time>+{Math.round(at - (log[i - 1]?.at ?? 0))} ms</time>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * Patches the game's IPA into Phigros++ in the browser (src/ipa.ts), with the latest release's library once the
 * release key's signature on it is checked. The IPA is only read, and nothing of it leaves the device.
 */
export function Patcher() {
  const p = useT().pppPage;
  const { number } = useFormat();
  const [pack, setPack] = useState<Pack | Error>();
  const [run, setRun] = useState<Run>();
  const [over, setOver] = useState(false);
  const ready = pack && !(pack instanceof Error);
  const busy = run && !run.url && !run.error;

  useEffect(() => {
    (async () => {
      const response = await fetch("/ios/phigrospp.ios");
      if (!response.ok) throw new Error(`phigros.tools answered ${response.status}`);
      const data = await opened(new Uint8Array(await response.arrayBuffer()));
      const { version, games } = (await import("../ipa")).unpack(data);
      setPack({ data, version, games });
    })().catch(setPack);
  }, []);

  // the patched IPA is let go when another one is patched or the page is left
  const url = run?.url;
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  async function start(file?: File) {
    if (!file || !ready || busy) return;
    const began = performance.now();
    const merge = (next: Partial<Run>) => setRun((run) => run && { ...run, ...next });
    setRun({ file, report: {}, log: [] });
    const tell: Tell = (line, facts) => {
      const at = performance.now() - began;
      setRun(
        (run) =>
          run && {
            ...run,
            report: { ...run.report, ...facts },
            log: [...run.log, { at, line }],
          },
      );
      // the page draws what was told before the next step keeps it busy
      return new Promise((resolve) => setTimeout(resolve));
    };
    try {
      const { patch } = await import("../ipa");
      const parts = await patch(file, pack.data, icon, tell);
      merge({ url: URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" })) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await tell(reason);
      merge({ error: reason });
    }
  }

  const { report, log } = run ?? { report: {} as Partial<Report>, log: [] };
  const failure =
    pack instanceof Error
      ? p.patchNoPack
      : run?.error &&
        (report.cryptid
          ? p.patchEncrypted
          : report.game && !report.games?.includes(report.game)
            ? p.patchUnsupported(report.game, report.games?.join(", ") ?? "")
            : p.patchFailed);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a file is dropped anywhere on it, the button chooses one too.
    <div
      className="patcher"
      data-over={over || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        void start(event.dataTransfer.files[0]);
      }}
    >
      <div className="patcher-bar">
        <div>
          <p role="status" className={failure ? "warning" : undefined}>
            {failure ||
              (run?.url
                ? p.patchReady(number(log[log.length - 1].at / 1000, { maximumFractionDigits: 1 }))
                : run
                  ? p.patchWorking
                  : p.patchDrop)}
          </p>
          <p className="meta">
            {pack instanceof Error
              ? pack.message
              : pack && p.patchPack(pack.version, pack.games.join(", "))}
          </p>
        </div>
        <div className="ppp-bar-actions">
          {run?.url && (
            <a className="btn start-go" href={run.url} download="Phigros++.ipa">
              {p.patchDownload} <Arrow />
            </a>
          )}
          <label className={`btn start-go${run?.url ? " btn-ghost" : ""}`}>
            {p.patchChoose}
            <input
              className="file-input"
              type="file"
              accept=".ipa"
              disabled={!ready || busy}
              onChange={(event) => {
                void start(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      {run && <Found run={run} />}
    </div>
  );
}
