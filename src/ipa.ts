// patches the game's ipa into phigros++, for scripts/patch_ipa.ts and phigros.tools (its src/ipa.ts is this file)

export type Bytes = Uint8Array<ArrayBuffer>;
export interface Section {
  name: string;
  addr: number;
  size: number;
  offset: number;
}
export interface Segment {
  name: string;
  vmaddr: number;
  vmsize: number;
  fileoff: number;
  filesize: number;
  sections: Section[];
  /** The format of its chained pointers and how many pages have some, when it has any. */
  format?: number;
  pages?: number;
}
export interface Module {
  name: string;
  at: number;
  methods: number;
}
/** A method the sources may hook. Its stub and slot are 0 when its first instruction can't move: only JIT hooks it. */
export interface Hook {
  name: string;
  at: number;
  stub: number;
  slot: number;
}
/** What patching found, told as it goes. */
export interface Report {
  version: string;
  games: string[];
  entries: number;
  game: string;
  cryptid: number;
  segments: Segment[];
  /** Where the load command of the library went. */
  load: number;
  metadata: number;
  types: number;
  codeRegistration: number;
  metadataRegistration: number;
  modules: Module[];
  methods: number;
  hooks: Hook[];
  /** Where the stubs and the slots may go, and where the last one ends. */
  stubs: [start: number, used: number, end: number];
  slots: [start: number, used: number, end: number];
  dropped: string[];
  size: number;
}
export type Tell = (line: string, facts?: Partial<Report>) => void | Promise<void>;
/** The store's artwork as a square PNG of that size, with the ++ tab. */
export type Icon = (artwork: Bytes, size: number) => Promise<Bytes>;
type Plist = boolean | bigint | string | Plist[] | { [key: string]: Plist };
type Macho = ReturnType<typeof macho>;

const APP = "Payload/Phigros.app/";
const PLIST = `${APP}Info.plist`;
const UNITY = `${APP}Frameworks/UnityFramework.framework/UnityFramework`;
const METADATA = `${APP}Data/Managed/Metadata/global-metadata.dat`;
const LIB = "Frameworks/libphigrospp.dylib";
// the store's data and the account that bought the game. each bundle's _CodeSignature/ and SC_Info/ (its encryption
// info) go too
const DROPPED = [
  "META-INF/",
  "iTunesMetadata.plist",
  "iTunesArtwork",
  `${APP}embedded.mobileprovision`,
];
// the home screen icon, drawn from the store's 600 px artwork with the ++ tab at every size ios asks for. the game's
// own comes from Assets.car, a compiled catalog, so CFBundleIconName goes and ios uses these files instead
const ICONS = {
  "AppIcon60x60@2x.png": 120,
  "AppIcon60x60@3x.png": 180,
  "AppIcon76x76@2x~ipad.png": 152,
  "AppIcon83.5x83.5@2x~ipad.png": 167,
};
const ICON_FILES = {
  CFBundleIcons: ["AppIcon60x60"],
  "CFBundleIcons~ipad": ["AppIcon60x60", "AppIcon76x76", "AppIcon83.5x83.5"],
};
const INFO = {
  CFBundleIdentifier: "sh.molly.phigrosplusplus",
  CFBundleDisplayName: "Phigros++",
  UIFileSharingEnabled: true, // Documents/phigros++ in the Files app, to add mods and charts
  LSSupportsOpeningDocumentsInPlace: true,
  CADisableMinimumFrameDurationOnPhone: true, // 120 Hz on iphones that have it
};

const text = new TextDecoder();
const encoded = (string: string) => new TextEncoder().encode(string);
const view = (data: Bytes) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const bytes = async (blob: Blob | Response) => new Uint8Array(await blob.arrayBuffer());
const u64 = (d: DataView, at: number) =>
  d.getUint32(at, true) + d.getUint32(at + 4, true) * 2 ** 32;
const cstring = (data: Bytes, at: number) => text.decode(data.subarray(at, data.indexOf(0, at)));
const hex = (n: number) => `0x${n.toString(16)}`;

// little endian fields of 2 (H) or 4 (I) bytes
function pack(format: string, ...values: number[]): Bytes {
  const sizes = [...format].map((field) => (field === "H" ? 2 : 4));
  const out = new DataView(new ArrayBuffer(sizes.reduce((sum, size) => sum + size, 0)));
  let at = 0;
  for (const [i, size] of sizes.entries()) {
    if (size === 2) out.setUint16(at, values[i], true);
    else out.setUint32(at, values[i], true);
    at += size;
  }
  return new Uint8Array(out.buffer);
}

/** The files scripts/build-ios.ts packed: "hooks" and a library for each game, named by its version. */
export function unpack(packed: Bytes) {
  let at = 0;
  const line = () => {
    const end = packed.indexOf(10, at);
    const read = text.decode(packed.subarray(at, end));
    at = end + 1;
    return read;
  };
  const [magic, platform, format, version] = line().split(" ");
  if (`${magic} ${platform}` !== "phigros++ ios")
    throw new Error("not what Phigros++ packs for iOS");
  if (format !== "1") throw new Error("this Phigros++ needs a newer patcher");
  const files = new Map<string, Bytes>();
  while (at < packed.length) {
    const name = line();
    const size = Number(line());
    files.set(name, packed.subarray(at, at + size));
    at += size;
  }
  return { version, games: [...files.keys()].filter((name) => name !== "hooks"), files };
}

interface Entry {
  name: string;
  raw: Bytes;
  made: number;
  // version needed, flags, method, time, date, crc, compressed size, size
  fields: number[];
  mode: number;
  offset: number;
}

async function directory(ipa: Blob): Promise<Entry[]> {
  // the end record is the last thing but a comment of 65535 bytes at most
  const tail = await bytes(ipa.slice(Math.max(0, ipa.size - 65557)));
  let end = tail.length - 22;
  while (end >= 0 && view(tail).getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not an IPA: it isn't a zip file");
  const start = view(tail).getUint32(end + 16, true);
  const central = await bytes(ipa.slice(start, start + view(tail).getUint32(end + 12, true)));
  const d = view(central);
  const entries: Entry[] = [];
  for (let at = 0; at < central.length; ) {
    const [name, extra, comment] = [28, 30, 32].map((field) => d.getUint16(at + field, true));
    const fields = [6, 8, 10, 12, 14].map((field) => d.getUint16(at + field, true));
    fields.push(...[16, 20, 24].map((field) => d.getUint32(at + field, true)));
    let offset = d.getUint32(at + 42, true);
    // zip64: the size, compressed size and offset that don't fit in 4 bytes are in the extra field 1, in that order
    for (let x = at + 46 + name; x < at + 46 + name + extra; x += 4 + d.getUint16(x + 2, true)) {
      if (d.getUint16(x, true) !== 1) continue;
      let wide = x + 4;
      for (const field of [7, 6])
        if (fields[field] === 0xffffffff) {
          fields[field] = u64(d, wide);
          wide += 8;
        }
      if (offset === 0xffffffff) offset = u64(d, wide);
    }
    const raw = central.subarray(at + 46, at + 46 + name);
    const [made, mode] = [d.getUint16(at + 4, true), d.getUint32(at + 38, true)];
    entries.push({ name: text.decode(raw), raw, made, fields, mode, offset });
    at += 46 + name + extra + comment;
  }
  return entries;
}

/** An entry's bytes as they are in the IPA, after its local header. */
async function stored(ipa: Blob, entry: Entry): Promise<Blob> {
  const header = view(await bytes(ipa.slice(entry.offset + 26, entry.offset + 30)));
  const start = entry.offset + 30 + header.getUint16(0, true) + header.getUint16(2, true);
  return ipa.slice(start, start + entry.fields[6]);
}

async function read(ipa: Blob, entry: Entry): Promise<Bytes> {
  const data = (await stored(ipa, entry)).stream();
  return bytes(
    new Response(entry.fields[2] ? data.pipeThrough(new DecompressionStream("deflate-raw")) : data),
  );
}

/** A new entry, deflated. The mode is its unix permissions. */
async function added(name: string, data: Bytes, mode: number): Promise<[Entry, Bytes]> {
  // gzip is the deflate stream a zip entry holds, between a 10 byte header and the crc32 and size the entry needs
  const gzip = await bytes(
    new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"))),
  );
  if (gzip[3]) throw new Error("gzip wrote more than its 10 byte header");
  const crc = view(gzip).getUint32(gzip.length - 8, true);
  // the first day of 2020
  const fields = [20, 0, 8, 0, (40 << 9) | (1 << 5) | 1, crc, gzip.length - 18, data.length];
  const entry = {
    name,
    raw: encoded(name),
    made: (3 << 8) | 20,
    fields,
    mode: mode * 65536,
    offset: 0,
  };
  return [entry, gzip.subarray(10, gzip.length - 8)];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The game's Info.plist, which is XML: a tag (closing, its name, empty) then the text up to the next one. */
function readPlist(source: string): Plist {
  const tags = [...source.matchAll(/<(\/?)(\w+)[^>]*?(\/?)>([^<]*)/g)];
  let at = 1; // after <plist>
  const value = (): Plist => {
    const [, , tag, empty, inside] = tags[at++];
    if (tag === "true" || tag === "false") return tag === "true";
    const list: Plist[] = [];
    if (tag === "array" || tag === "dict") while (!empty && !tags[at][1]) list.push(value());
    at += empty ? 0 : 1;
    if (tag === "array") return list;
    if (tag === "dict")
      return Object.fromEntries(list.flatMap((key, i) => (i % 2 ? [] : [[key, list[i + 1]]])));
    if (tag === "integer") return BigInt(inside);
    if (tag !== "key" && tag !== "string")
      throw new Error(`Info.plist has a <${tag}>, which isn't handled`);
    return inside.replace(/&(?:#(x?)([0-9a-f]+)|(\w+));/gi, (_, hex, code, name) =>
      code ? String.fromCodePoint(Number.parseInt(code, hex ? 16 : 10)) : ENTITIES[name],
    );
  };
  return value();
}

/** As Python's plistlib writes it: keys sorted, a scalar once per value, containers as many times as they are. */
function writePlist(root: Plist): Bytes {
  const list: Plist[] = [];
  const refs = new Map<unknown, number>();
  const key = (value: Plist) => (typeof value === "object" ? value : `${typeof value} ${value}`);
  const children = (value: Plist[] | { [key: string]: Plist }) => {
    if (Array.isArray(value)) return value;
    const keys = Object.keys(value).sort();
    return [...keys, ...keys.map((name) => value[name])];
  };
  const flatten = (value: Plist) => {
    if (refs.has(key(value))) return;
    refs.set(key(value), list.length);
    list.push(value);
    if (typeof value === "object") children(value).forEach(flatten);
  };
  flatten(root);
  const width = (count: number) => (count < 256 ? 1 : count < 65536 ? 2 : 4);
  const be = (n: number | bigint, size: number) =>
    Array.from({ length: size }, (_, i) =>
      Number((BigInt(n) >> BigInt(8 * (size - 1 - i))) & 255n),
    );
  const sized = (token: number, n: number) =>
    n < 15 ? [token | n] : [token | 15, 0x10 | Math.log2(width(n)), ...be(n, width(n))];
  const out = [...encoded("bplist00")];
  const offsets = list.map((value) => {
    const at = out.length;
    if (typeof value === "boolean") out.push(value ? 9 : 8);
    else if (typeof value === "bigint") {
      const size = value < 0 || value >= 2n ** 32n ? 8 : width(Number(value));
      out.push(0x10 | Math.log2(size), ...be(BigInt.asUintN(64, value), size));
    } else if (typeof value === "string") {
      const size = /^[\0-\x7f]*$/.test(value) ? 1 : 2;
      out.push(...sized(size === 1 ? 0x50 : 0x60, value.length));
      for (let i = 0; i < value.length; i++) out.push(...be(value.charCodeAt(i), size));
    } else {
      const inside = children(value);
      out.push(...sized(Array.isArray(value) ? 0xa0 : 0xd0, Object.keys(value).length));
      for (const child of inside) out.push(...be(refs.get(key(child))!, width(list.length)));
    }
    return at;
  });
  const table = out.length;
  for (const offset of offsets) out.push(...be(offset, width(table)));
  out.push(0, 0, 0, 0, 0, 0, width(table), width(list.length));
  out.push(...be(list.length, 8), ...be(0, 8), ...be(table, 8));
  return new Uint8Array(out);
}

function macho(data: Bytes) {
  const d = view(data);
  if (d.getUint32(0, true) !== 0xfeedfacf) throw new Error("UnityFramework isn't a 64-bit mach-o");
  const name = (at: number) => text.decode(data.subarray(at, at + 16)).replace(/\0+$/, "");
  const segments: Segment[] = [];
  let [cryptid, symbols, fixups] = [0, 0, 0];
  for (let at = 32, i = 0; i < d.getUint32(16, true); i++, at += d.getUint32(at + 4, true)) {
    const command = d.getUint32(at, true);
    if (command === 0x2c) cryptid = d.getUint32(at + 16, true); // LC_ENCRYPTION_INFO_64
    if (command === 0x2) symbols = at; // LC_SYMTAB
    if (command === 0x80000034) fixups = d.getUint32(at + 8, true); // LC_DYLD_CHAINED_FIXUPS
    if (command !== 0x19) continue; // LC_SEGMENT_64: its sections (80 bytes each) follow its 72 bytes
    const [vmaddr, vmsize, fileoff, filesize] = [24, 32, 40, 48].map((field) => u64(d, at + field));
    const sections = Array.from({ length: d.getUint32(at + 64, true) }, (_, n) => {
      const section = at + 72 + n * 80;
      const [addr, size] = [u64(d, section + 32), u64(d, section + 40)];
      return { name: name(section), addr, size, offset: d.getUint32(section + 48, true) };
    });
    segments.push({ name: name(at + 8), vmaddr, vmsize, fileoff, filesize, sections });
  }
  // a dyld_chained_starts_in_segment for each segment that has pointers, 0 for the others
  const starts = fixups + d.getUint32(fixups + 4, true);
  for (const [i, segment] of fixups ? segments.entries() : []) {
    const start = d.getUint32(starts + 4 + 4 * i, true);
    if (!start) continue;
    segment.format = d.getUint16(starts + start + 6, true);
    segment.pages = d.getUint16(starts + start + 20, true);
  }
  return { segments, cryptid, symbols, end: 32 + d.getUint32(20, true) };
}

// a LC_LOAD_DYLIB of the library after the last load command, in the free space before the first section
function loadLibrary(data: Bytes, { segments, end }: Macho) {
  const d = view(data);
  const offsets = segments.flatMap(({ sections }) => sections.map(({ offset }) => offset));
  const path = encoded(`@executable_path/${LIB}`);
  const size = 24 + path.length + 1 + (-(path.length + 1) & 7);
  if (
    end + size > Math.min(...offsets.filter(Boolean)) ||
    data.subarray(end, end + size).some(Boolean)
  )
    throw new Error("no room for a load command");
  data.set(pack("IIIIII", 0xc, size, 24, 2, 0, 0), end); // name offset, timestamp, versions
  data.set(path, end + 24);
  d.setUint32(16, d.getUint32(16, true) + 1, true);
  d.setUint32(20, end + size - 32, true);
}

// il2cppdumper's names of the kinds of type that aren't classes, by their number
const PRIMITIVES: Record<number, string> = {
  ...",void,bool,char,sbyte,byte,short,ushort,int,uint,long,ulong,float,double,string".split(","),
  22: "TypedReference",
  24: "IntPtr",
  25: "UIntPtr",
  28: "object",
};

/**
 * Where the game's methods are, each named Namespace.Class$$Method as il2cppdumper's script.json names them, the
 * instances of generic ones too.
 */
function il2cpp(unity: Bytes, { segments }: Macho, metadata: Bytes) {
  const d = view(unity);
  const m = view(metadata);
  if (m.getUint32(0, true) !== 0xfab11baf || m.getUint32(4, true) !== 31)
    throw new Error(`global-metadata.dat is version ${m.getUint32(4, true)}, only 31 is handled`);
  const data = segments.filter(({ format }) => format);
  if (!data.length || data.some(({ format }) => format !== 6))
    throw new Error("UnityFramework's pointers aren't DYLD_CHAINED_PTR_64_OFFSET");
  const offset = (address: number) => {
    const segment = segments.find(
      ({ vmaddr, filesize }) => address >= vmaddr && address < vmaddr + filesize,
    );
    if (!segment) throw new Error(`${hex(address)} isn't in UnityFramework`);
    return address - segment.vmaddr + segment.fileoff;
  };
  const number = (address: number) => u64(d, offset(address));
  const int = (address: number) => d.getInt32(offset(address), true);
  // a pointer is the 36 low bits of a chained fixup, an offset from __TEXT which starts at 0. the top bit marks an
  // import, which points nowhere in the file
  const chained = (at: number) => {
    const high = d.getUint32(at + 4, true);
    return high >>> 31 ? -1 : d.getUint32(at, true) + (high & 15) * 2 ** 32;
  };
  const pointer = (address: number) => chained(offset(address));
  // the address of the first word of the data passing the test, read as a pointer and as a number
  const find = (test: (target: number, value: number, address: number) => boolean) => {
    for (const { vmaddr, fileoff, filesize } of data)
      for (let at = fileoff; at < fileoff + filesize; at += 8)
        if (test(chained(at), u64(d, at), at - fileoff + vmaddr)) return at - fileoff + vmaddr;
    throw new Error("UnityFramework doesn't register its code as il2cpp 31 does");
  };

  // the header's tables, an offset and a size each: 2 is the strings, 5 the methods (36 bytes each), 12 the generic
  // parameters (16), 14 their containers (16), 19 the types (88), 20 the images (40)
  const table = (index: number) => m.getUint32(8 + 8 * index, true);
  const rows = (index: number, size: number) => m.getUint32(12 + 8 * index, true) / size;
  const string = (index: number) => cstring(metadata, table(2) + index);
  const typeDef = (index: number) => table(19) + 88 * index;
  const images = Array.from({ length: rows(20, 40) }, (_, i) => {
    const image = table(20) + 40 * i;
    const [start, count] = [m.getUint32(image + 8, true), m.getUint32(image + 12, true)];
    return { name: string(m.getUint32(image, true)), start, count };
  });

  // Il2CppMetadataRegistration is 16 words, the count of types being the 11th and the 13th
  const metadataRegistration =
    find((_, value, address) => value === rows(19, 88) && number(address + 16) === value) - 80;
  const [insts, generics, types, specs] = [3, 5, 7, 9].map((word) =>
    pointer(metadataRegistration + 8 * word),
  );
  // an image's name is the first word of its Il2CppCodeGenModule, then come the count of its methods and their
  // pointers. the count of modules and the array of pointers to them end the 17 words of Il2CppCodeRegistration
  const cstrings = segments[0].sections.find(({ name }) => name === "__cstring")!;
  const named = encoded(`\0${images[0].name}\0`);
  let name = cstrings.offset;
  while (!named.every((byte, i) => unity[name + i] === byte))
    if (++name >= cstrings.offset + cstrings.size)
      throw new Error(`UnityFramework doesn't name ${images[0].name}`);
  const module = find((target) => target === name + 1 - cstrings.offset + cstrings.addr);
  const listed = find((target) => target === module);
  const array = find(
    (target, _, address) =>
      target > listed - 8 * images.length &&
      target <= listed &&
      number(address - 8) === images.length,
  );
  const codeRegistration = array - 128;
  const modules = new Map(
    images.map((_, i) => {
      const at = pointer(pointer(array) + 8 * i);
      return [cstring(unity, offset(pointer(at))), { at, methods: number(at + 8) }];
    }),
  );

  const parameters = (container: number) => {
    const at = table(14) + 16 * container;
    const names = Array.from({ length: m.getInt32(at + 4, true) }, (_, i) =>
      string(m.getUint32(table(12) + 16 * (m.getInt32(at + 12, true) + i) + 4, true)),
    );
    return `<${names.join(", ")}>`;
  };
  // an Il2CppGenericInst is a count then the array of its types
  const instance = (at: number): string => {
    const names = Array.from({ length: number(at) }, (_, i) =>
      typeName(pointer(pointer(at + 8) + 8 * i), false, false),
    );
    return `<${names.join(", ")}>`;
  };
  // an Il2CppType is 8 bytes of data (an index or a pointer) then its kind in the 3rd byte of its flags
  const typeName = (at: number, namespace: boolean, nested: boolean): string => {
    const kind = unity[offset(at) + 10];
    if (kind === 0x14)
      return `${typeName(pointer(pointer(at)), namespace, false)}[${",".repeat(unity[offset(pointer(at)) + 8] - 1)}]`;
    if (kind === 0x1d) return `${typeName(pointer(at), namespace, false)}[]`;
    if (kind === 0xf) return `${typeName(pointer(at), namespace, false)}*`;
    if (kind === 0x13 || kind === 0x1e)
      return string(m.getUint32(table(12) + 16 * int(at) + 4, true));
    if (kind !== 0x11 && kind !== 0x12 && kind !== 0x15) return PRIMITIVES[kind];
    // a generic instance points to an Il2CppGenericClass: the type it's made from, then its instance
    const generic = kind === 0x15 ? pointer(at) : 0;
    const def = typeDef(int(generic ? pointer(generic) : at));
    const named = outer(def, namespace) + string(m.getUint32(def, true)).split("`")[0];
    if (nested) return named;
    if (generic) return named + instance(pointer(generic + 8));
    return m.getInt32(def + 24, true) < 0 ? named : named + parameters(m.getInt32(def + 24, true));
  };
  // the class a nested one is declared in, or its namespace
  const outer = (def: number, namespace: boolean) => {
    const declaring = m.getInt32(def + 12, true);
    const space = string(m.getUint32(def + 4, true));
    if (declaring !== -1) return `${typeName(pointer(types + 8 * declaring), namespace, true)}.`;
    return namespace && space ? `${space}.` : "";
  };
  const defName = (def: number, generic: boolean) => {
    const container = m.getInt32(def + 24, true);
    const named = string(m.getUint32(def, true));
    if (container < 0) return outer(def, true) + named;
    return outer(def, true) + named.split("`")[0] + (generic ? parameters(container) : "");
  };

  // the instances of generic methods: an Il2CppGenericMethodFunctionsDefinitions (16 bytes) names an Il2CppMethodSpec
  // (12 bytes: the method, its class's instance, its own) and its place among the generic method pointers
  const instances = new Map<number, number[]>();
  for (let i = 0; i < number(metadataRegistration + 32); i++) {
    const method = int(specs + 12 * int(generics + 16 * i));
    if (!instances.has(method)) instances.set(method, []);
    instances.get(method)!.push(generics + 16 * i);
  }
  const genericCode = pointer(codeRegistration + 24);

  function* methods(): Generator<[name: string, at: number]> {
    for (const image of images) {
      const pointers = pointer(modules.get(image.name)!.at + 16);
      for (let type = image.start; type < image.start + image.count; type++) {
        const def = typeDef(type);
        const first = m.getInt32(def + 36, true);
        for (let index = first; index < first + m.getUint16(def + 64, true); index++) {
          const method = table(5) + 36 * index;
          const named = string(m.getUint32(method, true));
          const at = pointer(pointers + 8 * ((m.getUint32(method + 24, true) & 0xffffff) - 1));
          if (at > 0) yield [`${defName(def, true)}$$${named}`, at];
          for (const entry of instances.get(index) ?? []) {
            const code = pointer(genericCode + 8 * int(entry + 4));
            const [of, own] = [1, 2].map((field) => int(specs + 12 * int(entry) + 4 * field));
            const args = [of, own].map((inst) =>
              inst < 0 ? "" : instance(pointer(insts + 8 * inst)),
            );
            if (code > 0) yield [`${defName(def, false)}${args[0]}$$${named}${args[1]}`, code];
          }
        }
      }
    }
  }
  return {
    types: rows(19, 88),
    codeRegistration,
    metadataRegistration,
    modules: [...modules].map(([name, module]) => ({ name, ...module })),
    methods,
  };
}

const WORD = "\\p{L}\\p{N}_";
// a coroutine or lambda class (Outer.<Start>d__4) counts as its outer class, which a pattern finds by that name alone
const OUTER = new RegExp(`^(?:[${WORD}.]*\\.)?([${WORD}]+)\\.<`, "u");

/**
 * The methods the sources may hook, by address: those whose name is one of their strings and whose class is made of
 * their names. A generic class isn't named at all, another one is with its namespace.
 */
function hooked(
  methods: Iterable<[string, number]>,
  hooks: { strings: string[]; names: string[] },
) {
  const [strings, names] = [new Set(hooks.strings), new Set(hooks.names)];
  const found = new Map<number, string>();
  let count = 0;
  for (const [method, at] of methods) {
    count++;
    const split = method.lastIndexOf("$$");
    const [type, name] = [method.slice(0, split), method.slice(split + 2)];
    const outer = OUTER.exec(type);
    const known = outer
      ? names.has(outer[1])
      : !type.includes("<") && type.split(".").every((part) => names.has(part));
    if (known && strings.has(name) && !found.has(at)) found.set(at, method);
  }
  return { count, found: [...found].sort(([a], [b]) => a - b) };
}

const B = 0x14000000;

function adrp(register: number, at: number, to: number) {
  const page = (Math.floor(to / 4096) - Math.floor(at / 4096)) & 0x1fffff;
  return 0x90000000 | ((page & 3) << 29) | ((page >> 2) << 5) | register;
}

/** The instruction at `at` moved to `to`, undefined when it can't be (a short pc relative one). */
function relocated(insn: number, at: number, to: number) {
  const is = (mask: number, value: number) => (insn & mask) >>> 0 === value;
  if (is(0x7c000000, B)) {
    // b, bl
    const target = at + ((insn & 0x3ffffff) ^ 0x2000000) * 4 - 0x8000000;
    return (insn & 0xfc000000) | (((target - to) >> 2) & 0x3ffffff);
  }
  if (is(0x9f000000, 0x90000000)) {
    // adrp
    const page = (((insn >>> 29) & 3) | (((insn >>> 5) & 0x7ffff) << 2)) ^ 0x100000;
    return adrp(insn & 31, to, at - (at % 4096) + (page - 0x100000) * 4096);
  }
  // adr, literal loads, cbz/tbz, b.cond
  if (
    is(0x9f000000, 0x10000000) ||
    is(0x3b000000, 0x18000000) ||
    is(0x7c000000, 0x34000000) ||
    is(0xff000010, 0x54000000)
  )
    return undefined;
  return insn;
}

function prepatch(data: Bytes, { segments, symbols }: Macho, methods: [number, string][]) {
  const d = view(data);
  const [code, rw] = ["__TEXT", "__DATA"].map((name) => {
    const segment = segments.find((segment) => segment.name === name)!;
    const end = Math.max(...segment.sections.map(({ addr, size }) => addr + size));
    return { ...segment, used: end, end: segment.vmaddr + segment.vmsize };
  });
  if (code.vmaddr || code.fileoff) throw new Error("__TEXT doesn't start the file");
  // the free end of __TEXT, zeros in the file, and of __DATA, zeros in memory
  let [stub, slot] = [Math.ceil(code.used / 16) * 16, Math.ceil(rw.used / 8) * 8];
  const [stubs, slots] = [stub, slot];
  if (data.subarray(stub, code.end).some(Boolean)) throw new Error("the end of __TEXT isn't free");
  const [symoff, nsyms, stroff] = [8, 12, 16].map((field) => d.getUint32(symbols + field, true));
  const init = Array.from({ length: nsyms }, (_, i) => symoff + 16 * i).find(
    (symbol) => cstring(data, stroff + d.getUint32(symbol, true)) === "_il2cpp_init",
  )!;
  const hooks: Hook[] = [];
  for (const [at, name] of [[u64(d, init + 8), "il2cpp_init"] as const, ...methods]) {
    if (at >= code.used) throw new Error(`${hex(at)} isn't code`);
    const moved = relocated(d.getUint32(at, true), at, stub + 16);
    if (moved === undefined) {
      hooks.push({ name, at, stub: 0, slot: 0 });
      continue;
    }
    if (stub + 24 > code.end || slot + 8 > rw.end)
      throw new Error("no room for more hooks at the end of UnityFramework's __TEXT (about 630)");
    // adrp x16, slot / ldr x16, [x16, slot] / cbz x16, +8 / br x16 / the method's first instruction / b back
    const load = 0xf9400210 | (((slot & 0xfff) >> 3) << 10);
    const back = B | (((at + 4 - stub - 20) >> 2) & 0x3ffffff);
    data.set(pack("IIIIII", adrp(16, stub, slot), load, 0xb4000050, 0xd61f0200, moved, back), stub);
    d.setUint32(at, B | (((stub - at) >> 2) & 0x3ffffff), true);
    hooks.push({ name, at, stub, slot });
    [stub, slot] = [stub + 24, slot + 8];
  }
  return {
    hooks,
    stubs: [stubs, stub, code.end] as Report["stubs"],
    slots: [slots, slot, rw.end] as Report["slots"],
  };
}

/** The parts of the patched IPA, to make a Blob of: what's new, and slices of the IPA for the rest. */
export async function patch(ipa: Blob, packed: Bytes, icon: Icon, tell: Tell): Promise<BlobPart[]> {
  const { version, games, files } = unpack(packed);
  await tell(`Phigros++ ${version} for Phigros ${games.join(", ")}`, { version, games });

  const entries = await directory(ipa);
  const entry = (name: string) => {
    const found = entries.find((entry) => entry.name === name);
    if (!found) throw new Error(`not a Phigros IPA: it has no ${name}`);
    return found;
  };
  const info = readPlist(text.decode(await read(ipa, entry(PLIST)))) as { [key: string]: Plist };
  const game = info.CFBundleShortVersionString as string;
  await tell(`${entries.length} entries, Phigros ${game}`, { entries: entries.length, game });
  if (!games.includes(game))
    throw new Error(`Phigros ${game} isn't supported, only ${games.join(", ")}`);

  const unity = await read(ipa, entry(UNITY));
  const binary = macho(unity);
  const { cryptid, segments } = binary;
  await tell(`UnityFramework: ${unity.length} bytes, cryptid ${cryptid}`, { cryptid, segments });
  if (cryptid) throw new Error("the IPA is encrypted, only a decrypted one can be patched");
  loadLibrary(unity, binary);
  await tell(`LC_LOAD_DYLIB @executable_path/${LIB} at ${hex(binary.end)}`, { load: binary.end });

  const { methods, ...registered } = il2cpp(unity, binary, await read(ipa, entry(METADATA)));
  await tell(
    `metadata 31: ${registered.types} types, ${registered.modules.length} modules, CodeRegistration at ${hex(registered.codeRegistration)}, MetadataRegistration at ${hex(registered.metadataRegistration)}`,
    { metadata: 31, ...registered },
  );
  const { count, found } = hooked(methods(), JSON.parse(text.decode(files.get("hooks"))));
  const prepared = prepatch(unity, binary, found);
  await tell(
    `${prepared.hooks.filter(({ stub }) => stub).length} of ${count} methods hookable without JIT`,
    { methods: count, ...prepared },
  );

  // without the store's artwork the game keeps its own icon
  const art = entries.find(({ name }) => name === "iTunesArtwork");
  const artwork = art && (await read(ipa, art));
  const dropped = entries.filter(
    ({ name }) =>
      DROPPED.some((prefix) => name.startsWith(prefix)) ||
      /\/(_CodeSignature|SC_Info)\//.test(name) ||
      (artwork && Object.hasOwn(ICONS, name.slice(APP.length))),
  );
  Object.assign(info, INFO);
  delete info.UISupportedDevices;
  for (const [key, icons] of Object.entries(artwork ? ICON_FILES : {}))
    info[key] = { CFBundlePrimaryIcon: { CFBundleIconFiles: icons } };

  const kept = entries
    .filter((entry) => !dropped.includes(entry))
    .map(async (entry): Promise<[Entry, BlobPart]> => {
      if (entry.name === PLIST) return added(PLIST, writePlist(info), 0o100644);
      if (entry.name === UNITY) return added(UNITY, unity, 0o100755);
      return [entry, await stored(ipa, entry)];
    });
  kept.push(added(APP + LIB, files.get(game)!, 0o100755));
  for (const [name, size] of Object.entries(artwork ? ICONS : {}))
    kept.push(icon(artwork!, size).then((png) => added(APP + name, png, 0o100644)));

  const out: BlobPart[] = [];
  const central: Bytes[] = [];
  let offset = 0;
  for (const [{ raw, made, fields, mode }, data] of await Promise.all(kept)) {
    const header = [fields[0], fields[1] & ~8, ...fields.slice(2), raw.length];
    out.push(pack("IHHHHHIIIHH", 0x04034b50, ...header, 0), raw, data);
    central.push(
      pack("IHHHHHHIIIHHHHHII", 0x02014b50, made, ...header, 0, 0, 0, 0, mode, offset),
      raw,
    );
    offset += 30 + raw.length + fields[6];
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  if (offset > 0xffffffff) throw new Error("the IPA is over 4 GB");
  out.push(
    ...central,
    pack("IHHHHIIH", 0x06054b50, 0, 0, kept.length, kept.length, size, offset, 0),
  );
  await tell(`Phigros++.ipa: ${offset + size + 22} bytes, ${dropped.length} entries left out`, {
    dropped: dropped.map(({ name }) => name),
    size: offset + size + 22,
  });
  return out;
}
