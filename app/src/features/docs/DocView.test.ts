/*
 * What a document is drawn as, and how a delimited file is read.
 *
 * Run with `npm test`.
 */
import { kindOf, parseDelimited } from "./DocView";

test("kinds by extension, and binary whatever the name", () => {
  expect(kindOf("a/README.md", "# x")).toBe("markdown");
  expect(kindOf("flow.mmd", "graph TD")).toBe("mermaid");
  expect(kindOf("data.csv", "a,b")).toBe("table");
  expect(kindOf("conf.json", "{}")).toBe("json");
  expect(kindOf("logo.svg", "<svg/>")).toBe("svg");
  expect(kindOf("tool.py", "print(1)")).toBe("text");
  expect(kindOf("Makefile", "all:")).toBe("text");
  expect(kindOf("x.pyc", "anything")).toBe("binary");
  expect(kindOf("notes.txt", "a\u0000b")).toBe("binary");
});

test("CSV with quoted cells, doubled quotes and CRLF", () => {
  expect(parseDelimited('name,note\r\n"Doe, J","said ""hi"""\nx,', ",")).toEqual([
    ["name", "note"],
    ["Doe, J", 'said "hi"'],
    ["x", ""],
  ]);
  expect(parseDelimited("a\tb\n1\t2", "\t")).toEqual([
    ["a", "b"],
    ["1", "2"],
  ]);
});
