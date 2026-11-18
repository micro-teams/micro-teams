/*
 * A picture's bytes as a data URI on a phone.
 *
 * Run with `npm test`.
 */
import { pictureUri } from "./pictures";

test("bytes become a base64 data URI with their type", () => {
  const bytes = new TextEncoder().encode("hello!?").buffer as ArrayBuffer;
  expect(pictureUri(bytes, "image/png")).toBe("data:image/png;base64,aGVsbG8hPw==");
  expect(pictureUri(new Uint8Array([1, 2]).buffer as ArrayBuffer, "image/gif")).toBe("data:image/gif;base64,AQI=");
});
