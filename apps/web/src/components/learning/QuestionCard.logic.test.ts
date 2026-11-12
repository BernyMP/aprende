import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vite-plus/test";

import { remarkPhrasingOnly } from "./QuestionCard.logic";

const flatten = (markdown: string) => {
  const tree = fromMarkdown(markdown);
  remarkPhrasingOnly()(tree);
  const [line] = tree.children;
  if (tree.children.length !== 1 || line?.type !== "paragraph" || line.data?.hName !== "span")
    throw new Error("Expected one span paragraph");
  return line.children.map((node) =>
    node.type === "text" || node.type === "inlineCode" ? `${node.type}:${node.value}` : node.type,
  );
};

describe("remarkPhrasingOnly", () => {
  it.each([
    ["`string | undefined`", ["inlineCode:string | undefined"]],
    [
      "Returns `T`, *not* `any`",
      ["text:Returns ", "inlineCode:T", "text:, ", "emphasis", "text: ", "inlineCode:any"],
    ],
    ["```ts\nconst x = 1;\n```", ["inlineCode:const x = 1;"]],
    ["- one\n- two", ["text:one", "text: ", "text:two"]],
    ["first\n\nsecond", ["text:first", "text: ", "text:second"]],
    ["<div> is a block", ["text:<div> is a block"]],
  ])("flattens %j to phrasing", (markdown, expected) => {
    expect(flatten(markdown)).toEqual(expected);
  });
});
