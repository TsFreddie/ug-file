const MD5_SHIFT_AMOUNTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];

const MD5_TABLE = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32));

export function md5Hex(input: Uint8Array): string {
  const bitLength = BigInt(input.length) * 8n;
  const paddedLength = (((input.length + 8) >>> 6) + 1) << 6;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;

  for (let index = 0; index < 8; index += 1) {
    bytes[paddedLength - 8 + index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(16);
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] =
        bytes[wordOffset] |
        (bytes[wordOffset + 1] << 8) |
        (bytes[wordOffset + 2] << 16) |
        (bytes[wordOffset + 3] << 24);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let f: number;
      let g: number;

      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }

      const nextD = d;
      d = c;
      c = b;
      b = add32(b, rotateLeft(add32(a, f, MD5_TABLE[index], words[g]), MD5_SHIFT_AMOUNTS[index]));
      a = nextD;
    }

    a0 = add32(a0, a);
    b0 = add32(b0, b);
    c0 = add32(c0, c);
    d0 = add32(d0, d);
  }

  return [a0, b0, c0, d0]
    .flatMap((word) => [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff])
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function rsaEncryptBase64(plaintext: string, base64Pem: string): string {
  const publicKey = parsePublicKey(base64Pem);
  const keySize = publicKey.modulusBytes.length;
  const blockSize = keySize - 11;
  const input = new TextEncoder().encode(plaintext);
  const encrypted = new Uint8Array(Math.ceil(input.length / blockSize) * keySize);
  let encryptedOffset = 0;

  for (let offset = 0; offset < input.length; offset += blockSize) {
    const block = input.subarray(offset, offset + blockSize);
    const padded = pkcs1Pad(block, keySize);
    const message = bytesToBigInt(padded);
    const cipher = modPow(message, publicKey.exponent, publicKey.modulus);
    encrypted.set(bigIntToBytes(cipher, keySize), encryptedOffset);
    encryptedOffset += keySize;
  }

  return bytesToBase64(encrypted);
}

function parsePublicKey(base64Pem: string): { modulus: bigint; exponent: bigint; modulusBytes: Uint8Array } {
  const decodedPem = base64ToString(base64Pem);
  const innerBase64 = decodedPem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s/g, "");
  const der = base64ToBytes(innerBase64);
  const reader = new DerReader(der);
  const root = reader.readSequence();

  try {
    const publicKeyInfo = new DerReader(root);
    publicKeyInfo.readSequence();
    const bitString = publicKeyInfo.readBitString();
    const pkcs1 = new DerReader(bitString);
    return readPkcs1PublicKey(pkcs1.readSequence());
  } catch {
    return readPkcs1PublicKey(root);
  }
}

function readPkcs1PublicKey(sequence: Uint8Array): { modulus: bigint; exponent: bigint; modulusBytes: Uint8Array } {
  const reader = new DerReader(sequence);
  const modulusBytes = stripLeadingZero(reader.readInteger());
  const exponentBytes = stripLeadingZero(reader.readInteger());
  return {
    modulus: bytesToBigInt(modulusBytes),
    exponent: bytesToBigInt(exponentBytes),
    modulusBytes
  };
}

function pkcs1Pad(input: Uint8Array, keySize: number): Uint8Array {
  if (input.length > keySize - 11) {
    throw new Error("RSA plaintext block is too large for PKCS#1 v1.5 padding.");
  }

  const output = new Uint8Array(keySize);
  output[0] = 0x00;
  output[1] = 0x02;
  fillRandomNonZero(output.subarray(2, keySize - input.length - 1));
  output[keySize - input.length - 1] = 0x00;
  output.set(input, keySize - input.length);
  return output;
}

function fillRandomNonZero(target: Uint8Array): void {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error("crypto.getRandomValues is required for RSA encryption.");
  }

  const random = new Uint8Array(target.length);
  let offset = 0;
  while (offset < target.length) {
    crypto.getRandomValues(random);
    for (const byte of random) {
      if (byte !== 0) {
        target[offset] = byte;
        offset += 1;
        if (offset === target.length) {
          break;
        }
      }
    }
  }
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let value = base % modulus;
  let power = exponent;

  while (power > 0n) {
    if (power & 1n) {
      result = (result * value) % modulus;
    }
    value = (value * value) % modulus;
    power >>= 1n;
  }

  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function stripLeadingZero(bytes: Uint8Array): Uint8Array {
  return bytes[0] === 0 ? bytes.subarray(1) : bytes;
}

function add32(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0);
}

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

function base64ToString(value: string): string {
  return new TextDecoder().decode(base64ToBytes(value));
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

class DerReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readSequence(): Uint8Array {
    return this.readValue(0x30);
  }

  readInteger(): Uint8Array {
    return this.readValue(0x02);
  }

  readBitString(): Uint8Array {
    const value = this.readValue(0x03);
    if (value[0] !== 0) {
      throw new Error("Unsupported DER bit string padding.");
    }
    return value.subarray(1);
  }

  private readValue(expectedTag: number): Uint8Array {
    const tag = this.bytes[this.offset];
    this.offset += 1;
    if (tag !== expectedTag) {
      throw new Error(`Unexpected DER tag ${tag}; expected ${expectedTag}.`);
    }

    const length = this.readLength();
    const start = this.offset;
    const end = start + length;
    this.offset = end;
    return this.bytes.subarray(start, end);
  }

  private readLength(): number {
    const first = this.bytes[this.offset];
    this.offset += 1;
    if ((first & 0x80) === 0) {
      return first;
    }

    const byteCount = first & 0x7f;
    let length = 0;
    for (let index = 0; index < byteCount; index += 1) {
      length = (length << 8) | this.bytes[this.offset];
      this.offset += 1;
    }
    return length;
  }
}
