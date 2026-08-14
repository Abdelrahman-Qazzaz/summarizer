import path from "node:path";

function withoutTypeScriptExtension(filePath) {
  return filePath.replace(/\.[cm]?[jt]sx?$/, "");
}

function isInsideDirectory(filePath, directory) {
  const relativePath = path.relative(directory, filePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Restrict imports from a module directory to one public entry point.",
    },
    schema: [
      {
        type: "object",
        properties: {
          directory: { type: "string" },
          entry: { type: "string" },
        },
        required: ["directory", "entry"],
        additionalProperties: false,
      },
    ],
    messages: {
      privateModule:
        "Only {{entry}}.ts is public outside {{directory}}. Import from that entry point instead.",
    },
  },

  create(context) {
    const [options] = context.options;
    const moduleDirectory = path.resolve(options.directory);
    const publicEntry = withoutTypeScriptExtension(
      path.join(moduleDirectory, options.entry),
    );
    const importerPath = withoutTypeScriptExtension(context.filename);

    if (isInsideDirectory(importerPath, moduleDirectory)) return {};

    function checkImportSource(sourceNode) {
      if (
        !sourceNode ||
        typeof sourceNode.value !== "string" ||
        !sourceNode.value.startsWith(".")
      )
        return;

      const importedPath = withoutTypeScriptExtension(
        path.resolve(path.dirname(importerPath), sourceNode.value),
      );

      if (
        !isInsideDirectory(importedPath, moduleDirectory) ||
        importedPath === publicEntry
      )
        return;

      context.report({
        node: sourceNode,
        messageId: "privateModule",
        data: {
          directory: path.basename(moduleDirectory),
          entry: options.entry,
        },
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
