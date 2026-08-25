
export const SAMPLES_PER_FRAME = 1024;

const FREQUENCY_INDEX = [
  96000, 88200, 64000, 48000, 44100, 32000,
  24000, 22050, 16000, 12000, 11025, 8000, 7350,
];


const u8 = (...values) => Uint8Array.from(values);

function u16(value) {
  return u8((value >> 8) & 0xff, value & 0xff);
}

function u32(value) {
  return u8((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function ascii(text) {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
}

function concat(parts) {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

function box(type, ...payload) {
  const body = concat(payload);
  return concat([u32(body.length + 8), ascii(type), body]);
}

function fullBox(type, version, flags, ...payload) {
  return box(type, u8(version), u8((flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff), ...payload);
}

function descriptor(tag, payload) {
  const length = [];
  let remaining = payload.length;
  do {
    length.unshift(remaining & 0x7f);
    remaining >>= 7;
  } while (remaining > 0);
  for (let i = 0; i < length.length - 1; i++) length[i] |= 0x80;
  return concat([u8(tag), Uint8Array.from(length), payload]);
}

export function audioSpecificConfig(sampleRate, channels) {
  const index = FREQUENCY_INDEX.indexOf(sampleRate);
  if (index < 0) throw new Error(`unsupported sample rate for AAC: ${sampleRate}`);
  const OBJECT_TYPE_AAC_LC = 2;
  const bits = (OBJECT_TYPE_AAC_LC << 11) | (index << 7) | (channels << 3);
  return u8((bits >> 8) & 0xff, bits & 0xff);
}


export class Mp4AacWriter {
  #sampleRate;
  #channels;
  #frames = [];
  #sizes = [];
  #description = null;
  #bitrate;

  constructor({ sampleRate = 44_100, channels = 1, bitrate = 64_000 } = {}) {
    this.#sampleRate = sampleRate;
    this.#channels = channels;
    this.#bitrate = bitrate;
  }

  get frameCount() { return this.#frames.length; }
  get durationSeconds() { return (this.#frames.length * SAMPLES_PER_FRAME) / this.#sampleRate; }

  addChunk(chunk, metadata) {
    const description = metadata?.decoderConfig?.description;
    if (description && !this.#description) {
      this.#description = new Uint8Array(
        description instanceof ArrayBuffer ? description : description.buffer ?? description,
      );
    }
    const bytes = new Uint8Array(chunk.byteLength);
    chunk.copyTo(bytes);
    this.addFrame(bytes);
  }

  addFrame(bytes) {
    if (bytes.length === 0) return;
    this.#frames.push(bytes);
    this.#sizes.push(bytes.length);
  }

  setDescription(bytes) {
    this.#description = Uint8Array.from(bytes);
  }

  finishBytes() {
    if (this.#frames.length === 0) {
      throw new Error("nothing was recorded: no AAC frames to write");
    }

    const asc = this.#description ?? audioSpecificConfig(this.#sampleRate, this.#channels);
    const audio = concat(this.#frames);
    const ftyp = this.#ftyp();

    const provisional = this.#moov(asc, 0);
    const audioOffset = ftyp.length + provisional.length + 8;
    const moov = this.#moov(asc, audioOffset);
    if (moov.length !== provisional.length) {
      throw new Error("moov length changed between passes: chunk offsets would be wrong");
    }

    return concat([ftyp, moov, box("mdat", audio)]);
  }

  finish() {
    return new Blob([this.finishBytes()], { type: "audio/mp4" });
  }


  #ftyp() {
    return box("ftyp", ascii("M4A "), u32(0), ascii("M4A "), ascii("mp42"), ascii("isom"));
  }

  #moov(asc, audioOffset) {
    const samples = this.#frames.length;
    const duration = samples * SAMPLES_PER_FRAME;

    const mvhd = fullBox(
      "mvhd", 0, 0,
      u32(0), u32(0), u32(this.#sampleRate), u32(duration),
      u32(0x0001_0000), // rate 1.0
      u16(0x0100), // volume 1.0
      u16(0), u32(0), u32(0),
      ...UNITY_MATRIX,
      u32(0), u32(0), u32(0), u32(0), u32(0), u32(0),
      u32(2), // next track id
    );

    const tkhd = fullBox(
      "tkhd", 0, 0x7,
      u32(0), u32(0), u32(1), u32(0), u32(duration),
      u32(0), u32(0),
      u16(0), u16(0),
      u16(0x0100), // volume — audio tracks carry it here, unlike video
      u16(0),
      ...UNITY_MATRIX,
      u32(0), u32(0), // width and height are zero: there is no picture
    );

    const mdhd = fullBox(
      "mdhd", 0, 0,
      u32(0), u32(0), u32(this.#sampleRate), u32(duration),
      u16(0x55c4), // 'und' — packed 5 bits per letter, offset from 0x60
      u16(0),
    );

    const hdlr = fullBox(
      "hdlr", 0, 0,
      u32(0), ascii("soun"), u32(0), u32(0), u32(0), ascii("SoundHandler\0"),
    );

    const dref = fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1));
    const dinf = box("dinf", dref);
    const smhd = fullBox("smhd", 0, 0, u16(0), u16(0));

    const esds = fullBox("esds", 0, 0, this.#esDescriptor(asc));
    const mp4a = box(
      "mp4a",
      u8(0, 0, 0, 0, 0, 0), u16(1), // reserved, data reference index
      u32(0), u32(0), // version, revision, vendor
      u16(this.#channels), u16(16), // channel count, sample size in bits
      u16(0), u16(0), // pre-defined, reserved
      u32(this.#sampleRate << 16), // 16.16 fixed point
      esds,
    );

    const stsd = fullBox("stsd", 0, 0, u32(1), mp4a);
    const stts = fullBox("stts", 0, 0, u32(1), u32(samples), u32(SAMPLES_PER_FRAME));
    const stsc = fullBox("stsc", 0, 0, u32(1), u32(1), u32(samples), u32(1));
    const stsz = fullBox("stsz", 0, 0, u32(0), u32(samples), ...this.#sizes.map(u32));
    const stco = fullBox("stco", 0, 0, u32(1), u32(audioOffset));

    const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
    const minf = box("minf", smhd, dinf, stbl);
    const mdia = box("mdia", mdhd, hdlr, minf);
    const trak = box("trak", tkhd, mdia);

    return box("moov", mvhd, trak);
  }

  #esDescriptor(asc) {
    const OBJECT_TYPE_MPEG4_AUDIO = 0x40;
    const STREAM_TYPE_AUDIO = 0x15; // (0x05 << 2) | 1 — audio stream, upstream flag clear

    const decoderSpecific = descriptor(0x05, asc);
    const decoderConfig = descriptor(0x04, concat([
      u8(OBJECT_TYPE_MPEG4_AUDIO, STREAM_TYPE_AUDIO),
      u8(0, 0, 0), // buffer size — zero is accepted and means "unspecified"
      u32(this.#bitrate), // max bitrate
      u32(this.#bitrate), // average bitrate
      decoderSpecific,
    ]));
    const slConfig = descriptor(0x06, u8(0x02));

    return descriptor(0x03, concat([
      u16(1), // ES_ID
      u8(0), // no dependency, no URL, no OCR
      decoderConfig,
      slConfig,
    ]));
  }
}

const UNITY_MATRIX = [
  u32(0x0001_0000), u32(0), u32(0),
  u32(0), u32(0x0001_0000), u32(0),
  u32(0), u32(0), u32(0x4000_0000),
];
