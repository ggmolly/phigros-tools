export class ParseError extends Error {
  constructor(
    message: string,
    readonly module: string,
    readonly offset: number,
    readonly field?: string,
  ) {
    super(`${module}${field ? `.${field}` : ""} @ ${offset}: ${message}`);
    this.name = "ParseError";
  }
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Bounded reader for Phigros' little-endian format. */
export class Reader {
  private readonly view: DataView;
  private bit = 0;
  offset = 0;

  constructor(
    bytes: Uint8Array,
    readonly module = "binary",
    private readonly baseOffset = 0,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining() {
    return this.view.byteLength - this.offset - (this.bit ? 1 : 0);
  }

  private fail(message: string, field?: string): never {
    throw new ParseError(message, this.module, this.baseOffset + this.offset, field);
  }

  private need(length: number, field?: string) {
    if (length < 0 || this.offset + length > this.view.byteLength) {
      this.fail(
        `need ${length} byte${length === 1 ? "" : "s"}, ${this.view.byteLength - this.offset} remain`,
        field,
      );
    }
  }

  private align() {
    if (this.bit) {
      this.offset += 1;
      this.bit = 0;
    }
  }

  bool(field?: string): boolean {
    if (this.bit === 8) {
      this.offset += 1;
      this.bit = 0;
    }
    this.need(1, field);
    return ((this.view.getUint8(this.offset) >> this.bit++) & 1) === 1;
  }

  u8(field?: string): number {
    this.align();
    this.need(1, field);
    return this.view.getUint8(this.offset++);
  }

  i16(field?: string): number {
    this.align();
    this.need(2, field);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i32(field?: string): number {
    this.align();
    this.need(4, field);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f32(field?: string): number {
    this.align();
    this.need(4, field);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  varshort(field?: string): number {
    const first = this.u8(field);
    if (!(first & 0x80)) return first;
    return (first & 0x7f) | (this.u8(field) << 7);
  }

  bytes(length: number, field?: string): Uint8Array {
    this.align();
    this.need(length, field);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return bytes;
  }

  string(field?: string): string {
    const length = this.varshort(field);
    const start = this.offset;
    try {
      return decoder.decode(this.bytes(length, field));
    } catch {
      throw new ParseError("invalid UTF-8", this.module, this.baseOffset + start, field);
    }
  }

  subReader(length: number, field?: string): Reader {
    this.align();
    const start = this.offset;
    return new Reader(
      this.bytes(length, field),
      `${this.module}${field ? `.${field}` : ""}`,
      this.baseOffset + start,
    );
  }

  finish(field?: string) {
    this.align();
    if (this.offset !== this.view.byteLength) {
      this.fail(
        `${this.view.byteLength - this.offset} trailing byte${this.view.byteLength - this.offset === 1 ? "" : "s"}`,
        field,
      );
    }
  }
}
