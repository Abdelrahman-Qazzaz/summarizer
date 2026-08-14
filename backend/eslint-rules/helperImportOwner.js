import path from "node:path";

const HELPER_SUFFIX = ".helper";

function baseNameWithoutExtension(filePath) {
  return path.basename(filePath).replace(/\.tsx?$/, "");
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "A *.helper.ts module may only be imported by the sibling module of the same name.",
    },
    schema: [],
    messages: {
      foreignHelper:
        "{{helper}}.helper.ts is private to {{helper}}.ts — to share this code, move it into a module without the .helper suffix.",
    },
  },

  create(context) {
    const importerDirectory = path.dirname(context.filename);
    // A colocated test inherits the access of the module it covers.
    const importerName = baseNameWithoutExtension(context.filename).replace(
      /\.(test|spec)$/,
      "",
    );

    function checkImportSource(sourceNode) {
      if (!sourceNode || typeof sourceNode.value !== "string") return;

      const importedName = baseNameWithoutExtension(sourceNode.value);
      if (!importedName.endsWith(HELPER_SUFFIX)) return;

      const helperOwner = importedName.slice(0, -HELPER_SUFFIX.length);
      const isSibling =
        sourceNode.value.startsWith(".") &&
        path.dirname(path.resolve(importerDirectory, sourceNode.value)) ===
          importerDirectory;

      if (isSibling && helperOwner === importerName) return;

      context.report({
        node: sourceNode,
        messageId: "foreignHelper",
        data: { helper: helperOwner },
      });
    }

    return {
      ImportDeclaration: (node) => checkImportSource(node.source),
      ImportExpression: (node) => checkImportSource(node.source),
      ExportNamedDeclaration: (node) => checkImportSource(node.source),
      ExportAllDeclaration: (node) => checkImportSource(node.source),
    };
  },
};
