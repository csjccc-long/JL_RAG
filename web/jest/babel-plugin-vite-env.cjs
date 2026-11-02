module.exports = function viteEnvPlugin({ types: t }) {
  return {
    name: 'vite-env',
    visitor: {
      CallExpression(path) {
        const { node } = path;
        if (
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.property, { name: 'glob' }) &&
          t.isMetaProperty(node.callee.object) &&
          node.callee.object.meta.name === 'import' &&
          node.callee.object.property.name === 'meta'
        ) {
          path.replaceWith(t.objectExpression([]));
        }
      },
      MemberExpression(path) {
        const { node } = path;
        if (
          !node.computed &&
          t.isIdentifier(node.property, { name: 'env' }) &&
          t.isMetaProperty(node.object) &&
          node.object.meta.name === 'import' &&
          node.object.property.name === 'meta'
        ) {
          path.replaceWith(
            t.memberExpression(t.identifier('process'), t.identifier('env')),
          );
        }
      },
    },
  };
};
