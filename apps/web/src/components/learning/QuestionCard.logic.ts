import type { PhrasingContent, Root, RootContent } from "mdast";
import type { PluggableList } from "unified";

/** Options render inside a button, which only holds phrasing, so blocks flatten to one line. */
export function remarkPhrasingOnly() {
  return (tree: Root) => {
    const phrasing: PhrasingContent[] = [];
    const push = (...nodes: PhrasingContent[]) => {
      if (phrasing.length > 0) phrasing.push({ type: "text", value: " " });
      phrasing.push(...nodes);
    };
    const visit = (node: RootContent) => {
      if (node.type === "paragraph" || node.type === "heading") push(...node.children);
      else if (node.type === "code") push({ type: "inlineCode", value: node.value });
      else if (node.type === "definition") return;
      else if ("children" in node) for (const child of node.children) visit(child);
      else if ("value" in node) push({ type: "text", value: node.value });
    };
    for (const node of tree.children) visit(node);
    // A span below the root, so inline-code styles that skip direct children still apply.
    tree.children = [{ type: "paragraph", data: { hName: "span" }, children: phrasing }];
  };
}

export const OPTION_MARKDOWN_PLUGINS: PluggableList = [remarkPhrasingOnly];
