export function wasmProducerSection(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])))
    throw new Error("Invalid original WASM header");
  function integer(offset) {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      if (offset >= bytes.length) throw new Error("Truncated WASM section");
      const byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return [value, offset];
    }
    throw new Error("Invalid WASM section length");
  }
  for (let offset = 8; offset < bytes.length; ) {
    const type = bytes[offset];
    const [length, start] = integer(offset + 1);
    const end = start + length;
    if (end > bytes.length) throw new Error("Truncated WASM section content");
    if (type === 0) {
      const [nameLength, nameStart] = integer(start);
      if (nameStart + nameLength > end) throw new Error("Invalid WASM custom section");
      if (bytes.subarray(nameStart, nameStart + nameLength).toString("utf8") === "producers")
        return bytes.subarray(nameStart + nameLength, end).toString("utf8");
    }
    offset = end;
  }
  throw new Error("Missing original WASM producer section");
}
