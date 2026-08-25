import path from "node:path";

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
      description: "Prevent configured directories from importing each other.",
    },
    schema: [
      {
        type: "object",
        properties: {
          directories: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            uniqueItems: true,
          },
        },
        required: ["directories"],
        additionalProperties: false,
      },
    ],
    messages: {
      crossDirectory:
        "{{importer}} cannot import from {{imported}}. Move shared code to shared/.",
    },
  },

  create(context) {
    const [options] = context.options;
    const directories = options.directories.map((directory) =>
      path.resolve(directory),
    );
    const importerPath = path.resolve(context.filename);
    const importerDirectory = directories.find((directory) =>
      isInsideDirectory(importerPath, directory),
    );

    if (!importerDirectory) return {};

    function checkImportSource(sourceNode) {
      if (
        !sourceNode ||
        typeof sourceNode.value !== "string" ||
        !sourceNode.value.startsWith(".")
      )
        return;

      const importedPath = path.resolve(
        path.dirname(importerPath),
        sourceNode.value,
      );
      const importedDirectory = directories.find((directory) =>
        isInsideDirectory(importedPath, directory),
      );

      if (!importedDirectory || importedDirectory === importerDirectory) return;

      context.report({
        node: sourceNode,
        messageId: "crossDirectory",
        data: {
          importer: path.basename(importerDirectory),
          imported: path.basename(importedDirectory),
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
