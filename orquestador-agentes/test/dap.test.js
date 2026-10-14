const test = require("node:test");
const assert = require("node:assert/strict");
const { encode, createParser } = require("../dap");

const collect = () => {
  const got = [];
  return { got, push: createParser((m) => got.push(m)) };
};

test("encode cuenta la longitud en bytes, no en caracteres", () => {
  const out = encode({ t: "ñ🚀" }).toString("utf8");
  const body = JSON.stringify({ t: "ñ🚀" });
  assert.equal(out, `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
});

test("el parser entrega un mensaje y dos seguidos en el mismo trozo", () => {
  const p = collect();
  p.push(Buffer.concat([encode({ a: 1 }), encode({ b: 2 })]));
  assert.deepEqual(p.got, [{ a: 1 }, { b: 2 }]);
});

test("el parser junta un mensaje partido byte a byte, multibyte incluido", () => {
  const p = collect();
  const buf = encode({ t: "ñ🚀" });
  for (let i = 0; i < buf.length; i++) p.push(buf.subarray(i, i + 1));
  assert.deepEqual(p.got, [{ t: "ñ🚀" }]);
});

test("cabecera sin Content-Length y JSON roto se saltan sin perder el siguiente", () => {
  const p = collect();
  p.push(Buffer.from("X-Otra: 1\r\n\r\n"));
  p.push(Buffer.from("Content-Length: 5\r\n\r\n{roto"));
  p.push(encode({ ok: true }));
  assert.deepEqual(p.got, [{ ok: true }]);
});

test("acepta trozos en string", () => {
  const p = collect();
  p.push(encode({ s: 1 }).toString("utf8"));
  assert.deepEqual(p.got, [{ s: 1 }]);
});
