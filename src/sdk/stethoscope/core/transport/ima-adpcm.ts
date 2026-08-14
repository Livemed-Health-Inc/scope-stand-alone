/**
 * IMA/DVI 4-bit ADPCM decoder matching `PcmCodec::imaDecodeData` in the vendor
 * MinttiSmarthoSDK: the stethoscope streams compressed mic audio, not raw PCM,
 * which is why a plain 16-bit read of the GATT payload sounds like noise.
 *
 * The vendor codec decodes the high nibble first and maintains two different
 * values: an emitted sample and a predictor advanced by its own step formula.
 */

const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

export interface ImaState {
  predictor: number;
  index: number;
  /** Previous emitted sample. The vendor SDK keeps this separate from predictor. */
  sample: number;
}

export const createImaState = (): ImaState => ({ predictor: 0, index: 0, sample: 0 });

/**
 * Decodes `length` ADPCM bytes into 2x that many 16-bit samples, mutating `state`.
 * Mirrors `PcmCodec::imaDecodeData` from the SDK rather than generic IMA ADPCM.
 */
export function imaDecode(
  bytes: Uint8Array,
  offset: number,
  length: number,
  state: ImaState,
  highNibbleFirst = true,
): Int16Array {
  const out = new Int16Array(length * 2);
  let o = 0;

  for (let i = 0; i < length; i++) {
    const byte = bytes[offset + i] ?? 0;
    const nibbles = highNibbleFirst
      ? [(byte >> 4) & 0x0f, byte & 0x0f]
      : [byte & 0x0f, (byte >> 4) & 0x0f];

    for (const nibble of nibbles) {
      const step = STEP_TABLE[state.index] ?? 7;
      let emittedDiff = 0;
      let bit = 4;
      let scaledStep = step << 3;
      for (let j = 0; j < 3; j++) {
        if (nibble & bit) emittedDiff += scaledStep;
        bit >>= 1;
        scaledStep >>= 1;
      }
      emittedDiff >>= 3;
      if (nibble & 8) emittedDiff = -emittedDiff;
      state.sample = state.predictor + emittedDiff;
      if (state.sample > 32767) state.sample = 32767;
      else if (state.sample < -32768) state.sample = -32768;
      out[o++] = state.sample;

      const predictorDiff = (((nibble & 7) * step) + step) >> 2;
      state.predictor += nibble & 8 ? -predictorDiff : predictorDiff;
      if (state.predictor > 32767) state.predictor = 32767;
      else if (state.predictor < -32768) state.predictor = -32768;

      state.index += INDEX_TABLE[nibble & 7] ?? 0;
      if (state.index < 0) state.index = 0;
      else if (state.index > 88) state.index = 88;
    }
  }
  return out;
}

/**
 * Frame layouts recovered from the vendor Android app's packet handler. Each BLE
 * notification carries a chest block and an ambient/echo-reference block, and the
 * two blocks are NOT always encoded the same way: on most frame sizes the chest
 * audio is plain little-endian 16-bit PCM while only the reference mic is ADPCM.
 * Decoding the chest block as ADPCM is what turned heart sounds into hiss.
 */
type Block = { offset: number; length: number; codec: "pcm" | "adpcm" };

const FRAME_LAYOUT: Record<number, { chest: Block; reference: Block | null }> = {
  150: {
    chest: { offset: 30, length: 120, codec: "pcm" },
    reference: { offset: 0, length: 30, codec: "adpcm" },
  },
  158: {
    chest: { offset: 38, length: 120, codec: "pcm" },
    reference: { offset: 8, length: 30, codec: "adpcm" },
  },
  508: {
    chest: { offset: 8, length: 400, codec: "pcm" },
    reference: { offset: 408, length: 100, codec: "adpcm" },
  },
  180: {
    chest: { offset: 0, length: 90, codec: "adpcm" },
    reference: { offset: 90, length: 90, codec: "adpcm" },
  },
  240: {
    chest: { offset: 0, length: 240, codec: "adpcm" },
    reference: null,
  },
};

function readPcm(bytes: Uint8Array, offset: number, length: number): Int16Array {
  const count = length >> 1;
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const lo = bytes[offset + i * 2] ?? 0;
    const hi = bytes[offset + i * 2 + 1] ?? 0;
    out[i] = (((hi << 8) | lo) << 16) >> 16;
  }
  return out;
}

export interface DecodedFrame {
  chest: Int16Array;
  reference: Int16Array | null;
}

/**
 * Decodes one BLE notification into its chest and reference channels using the
 * firmware's per-length frame layout.
 */
export function decodeFrame(
  bytes: Uint8Array,
  chestState: ImaState,
  referenceState: ImaState,
  highNibbleFirst = true,
): DecodedFrame | null {
  const layout = FRAME_LAYOUT[bytes.length];
  if (!layout) {
    // Unknown length: assume an 8-byte header followed by linear PCM.
    if (bytes.length <= 16) return null;
    return { chest: readPcm(bytes, 8, (bytes.length - 8) & ~1), reference: null };
  }
  const decode = (block: Block, state: ImaState) =>
    block.codec === "pcm"
      ? readPcm(bytes, block.offset, block.length)
      : imaDecode(bytes, block.offset, block.length, state, highNibbleFirst);

  return {
    chest: decode(layout.chest, chestState),
    reference: layout.reference ? decode(layout.reference, referenceState) : null,
  };
}
