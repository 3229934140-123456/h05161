const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

class DependencyParser {
  constructor(options = {}) {
    this.resolve = options.resolve || this.defaultResolve.bind(this);
    this.extensions = options.extensions || ['.js', '.jsx', '.ts', '.tsx'];
    this.babelOptions = {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'dynamicImport', 'classProperties']
    };
  }

  defaultResolve(modulePath, currentFile) {
    const currentDir = path.dirname(currentFile);
    let resolvedPath = path.resolve(currentDir, modulePath);

    if (!path.extname(resolvedPath)) {
      for (const ext of this.extensions) {
        if (fs.existsSync(resolvedPath + ext)) {
          return resolvedPath + ext;
        }
      }
      if (fs.existsSync(path.join(resolvedPath, 'index.js'))) {
        return path.join(resolvedPath, 'index.js');
      }
    }

    return resolvedPath;
  }

  parse(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ast = parser.parse(content, { ...this.babelOptions, sourceFilename: filePath });

    const imports = [];
    const exports = [];
    const dynamicImports = [];
    const topLevelNodes = [];
    const self = this;

    traverse(ast, {
      Program: {
        enter(path) {
          path.traverse({
            ImportDeclaration(p) {
              const source = p.node.source.value;
              const specifiers = p.node.specifiers.map(s => ({
                type: s.type,
                imported: s.imported ? s.imported.name : 'default',
                local: s.local.name
              }));
              imports.push({
                source,
                specifiers,
                loc: p.node.loc,
                start: p.node.start,
                end: p.node.end
              });
            },

            ExportDefaultDeclaration(p) {
              const declaration = p.node.declaration;
              let exportName = 'default';
              let declarationName = null;
              let declarationType = null;
              let declarationLoc = p.node.loc;

              if (t.isIdentifier(declaration)) {
                declarationName = declaration.name;
                declarationType = 'identifier';
              } else if (t.isFunctionDeclaration(declaration) || t.isClassDeclaration(declaration)) {
                declarationName = declaration.id ? declaration.id.name : null;
                declarationType = declaration.type;
              } else {
                declarationType = 'expression';
              }

              exports.push({
                name: exportName,
                type: 'default',
                declarationName,
                declarationType,
                declarationLoc,
                loc: p.node.loc,
                start: p.node.start,
                end: p.node.end,
                declarationStart: declaration.start,
                declarationEnd: declaration.end
              });
            },

            ExportNamedDeclaration(p) {
              if (p.node.declaration) {
                const declaration = p.node.declaration;
                if (t.isVariableDeclaration(declaration)) {
                  declaration.declarations.forEach(decl => {
                    const names = self.extractNames(decl.id);
                    names.forEach(name => {
                      exports.push({
                        name,
                        type: 'named',
                        declarationName: name,
                        declarationType: 'variable',
                        declarationLoc: decl.loc,
                        loc: p.node.loc,
                        start: p.node.start,
                        end: p.node.end,
                        declarationStart: declaration.start,
                        declarationEnd: declaration.end
                      });
                    });
                  });
                } else if (t.isFunctionDeclaration(declaration) || t.isClassDeclaration(declaration)) {
                  const name = declaration.id ? declaration.id.name : null;
                  if (name) {
                    exports.push({
                      name,
                      type: 'named',
                      declarationName: name,
                      declarationType: declaration.type,
                      declarationLoc: declaration.loc,
                      loc: p.node.loc,
                      start: p.node.start,
                      end: p.node.end,
                      declarationStart: declaration.start,
                      declarationEnd: declaration.end
                    });
                  }
                }
              } else if (p.node.specifiers && p.node.specifiers.length > 0) {
                p.node.specifiers.forEach(s => {
                  exports.push({
                    name: s.exported.name,
                    type: 'named',
                    declarationName: s.local.name,
                    declarationType: 're-export',
                    source: p.node.source ? p.node.source.value : null,
                    declarationLoc: s.loc,
                    loc: p.node.loc,
                    start: p.node.start,
                    end: p.node.end,
                    declarationStart: s.start,
                    declarationEnd: s.end
                  });
                });
              }
            },

            ExportAllDeclaration(p) {
              exports.push({
                name: '*',
                type: 'namespace',
                source: p.node.source.value,
                declarationType: 'namespace',
                loc: p.node.loc,
                start: p.node.start,
                end: p.node.end
              });
            },

            CallExpression(p) {
              if (t.isImport(p.node.callee)) {
                const arg = p.node.arguments[0];
                if (t.isStringLiteral(arg)) {
                  dynamicImports.push({
                    source: arg.value,
                    loc: p.node.loc,
                    start: p.node.start,
                    end: p.node.end,
                    node: p.node
                  });
                }
              }
            },

            noScope: true
          });

          path.node.body.forEach(stmt => {
            if (!t.isImportDeclaration(stmt) && !t.isExportDeclaration(stmt)) {
              topLevelNodes.push({
                type: stmt.type,
                start: stmt.start,
                end: stmt.end,
                loc: stmt.loc,
                names: self.extractTopLevelNames(stmt)
              });
            }
          });
        }
      }
    });

    return {
      filePath,
      content,
      ast,
      imports,
      exports,
      dynamicImports,
      topLevelNodes,
      source: content
    };
  }

  extractNames(node) {
    const names = [];
    if (t.isIdentifier(node)) {
      names.push(node.name);
    } else if (t.isObjectPattern(node)) {
      node.properties.forEach(prop => {
        if (t.isRestElement(prop)) {
          names.push(prop.argument.name);
        } else {
          names.push(...this.extractNames(prop.value));
        }
      });
    } else if (t.isArrayPattern(node)) {
      node.elements.forEach(el => {
        if (el) {
          if (t.isRestElement(el)) {
            names.push(el.argument.name);
          } else {
            names.push(...this.extractNames(el));
          }
        }
      });
    }
    return names;
  }

  extractTopLevelNames(stmt) {
    const names = [];
    if (t.isVariableDeclaration(stmt)) {
      stmt.declarations.forEach(decl => {
        names.push(...this.extractNames(decl.id));
      });
    } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
      names.push(stmt.id.name);
    } else if (t.isClassDeclaration(stmt) && stmt.id) {
      names.push(stmt.id.name);
    }
    return names;
  }
}

module.exports = DependencyParser;
