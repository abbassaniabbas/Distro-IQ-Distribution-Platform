const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;

  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function bytesForContent(content) {
  if (content instanceof Uint8Array) return content;
  if (typeof content === "string") return encoder.encode(content);

  return encoder.encode(JSON.stringify(content, null, 2));
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { time, day };
}

function makeHeader(size, signature) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, signature, true);

  return { bytes, view };
}

function concatBytes(parts) {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });

  return output;
}

export function createZipBlob(files) {
  const localParts = [];
  const centralParts = [];
  const now = new Date();
  const stamp = dosDateTime(now);
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = bytesForContent(file.content);
    const crc = crc32(contentBytes);
    const localOffset = offset;
    const local = makeHeader(30, 0x04034b50);

    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0, true);
    local.view.setUint16(8, 0, true);
    local.view.setUint16(10, stamp.time, true);
    local.view.setUint16(12, stamp.day, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, contentBytes.length, true);
    local.view.setUint32(22, contentBytes.length, true);
    local.view.setUint16(26, nameBytes.length, true);
    local.view.setUint16(28, 0, true);

    localParts.push(local.bytes, nameBytes, contentBytes);
    offset += local.bytes.length + nameBytes.length + contentBytes.length;

    const central = makeHeader(46, 0x02014b50);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0, true);
    central.view.setUint16(10, 0, true);
    central.view.setUint16(12, stamp.time, true);
    central.view.setUint16(14, stamp.day, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, contentBytes.length, true);
    central.view.setUint32(24, contentBytes.length, true);
    central.view.setUint16(28, nameBytes.length, true);
    central.view.setUint16(30, 0, true);
    central.view.setUint16(32, 0, true);
    central.view.setUint16(34, 0, true);
    central.view.setUint16(36, 0, true);
    central.view.setUint32(38, 0, true);
    central.view.setUint32(42, localOffset, true);

    centralParts.push(central.bytes, nameBytes);
  });

  const centralDirectory = concatBytes(centralParts);
  const end = makeHeader(22, 0x06054b50);

  end.view.setUint16(4, 0, true);
  end.view.setUint16(6, 0, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralDirectory.length, true);
  end.view.setUint32(16, offset, true);
  end.view.setUint16(20, 0, true);

  return new Blob([...localParts, centralDirectory, end.bytes], {
    type: "application/zip"
  });
}
