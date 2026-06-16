const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const MagicString = require('magic-string');

class Optimizer {
  constructor(options = {}) {
    this.moduleGraph = options.moduleGraph;
    this.treeshake = options.treeshake !== false;
    this.sideEffects = options.sideEffects !== false;
  }

  optimize() {
    if (!this.moduleGraph) return;

    if (this.treeshake) {
      this.analyzeUsedExports();
      this.eliminateDeadCode();
    }

    this.analyzeSideEffects();
    return this;
  }

  analyzeUsedExports() {
    const entryModules = this.moduleGraph.getEntryModules();
    const dynamicEntryModules = this.moduleGraph.getDynamicEntryModules();
    const allEntries = [...entryModules, ...dynamicEntryModules];

    for (const module of allEntries) {
      if (module) {
        this.markModuleExportsUsed(module, new Set());
      }
    }

    const allModules = this.moduleGraph.getAllModules();
    for (const module of allModules) {
      const moduleHasImports = module.imports && module.imports.length > 0;
      const moduleIsEntry = module.isEntry || module.isDynamicEntry;
      const moduleHasSideEffects = this.checkModuleSideEffects(module);

      if (moduleHasSideEffects || moduleIsEntry) {
        module.usedExports.add('__side_effects__');
      }

      if (moduleHasImports) {
        for (const imp of module.imports) {
          const resolved = this.moduleGraph.parser.resolve(imp.source, module.filePath);
          const depModule = this.moduleGraph.getModule(resolved);

          if (depModule) {
            for (const spec of imp.specifiers) {
              if (spec.type === 'ImportNamespaceSpecifier') {
                this.markAllExportsUsed(depModule);
              } else if (spec.imported === '*') {
                this.markAllExportsUsed(depModule);
              } else if (module.usedExports.has(spec.local) || moduleHasSideEffects || moduleIsEntry) {
                if (spec.imported === 'default') {
                  depModule.usedExports.add('default');
                } else {
                  depModule.usedExports.add(spec.imported);
                }
              }
            }
          }
        }
      }
    }
  }

  markModuleExportsUsed(module, visited) {
    if (!module || visited.has(module.id)) return;
    visited.add(module.id);

    module.usedExports.add('__side_effects__');

    if (!module.parsed) return;

    const usedNames = new Set();

    traverse(module.parsed.ast, {
      Identifier(path) {
        if (path.isReferenced()) {
          usedNames.add(path.node.name);
        }
      },
      noScope: false
    });

    for (const name of usedNames) {
      module.usedExports.add(name);
    }

    for (const imp of module.parsed.imports) {
      const resolved = this.moduleGraph.parser.resolve(imp.source, module.filePath);
      const depModule = this.moduleGraph.getModule(resolved);

      if (depModule) {
        for (const spec of imp.specifiers) {
          if (spec.type === 'ImportNamespaceSpecifier') {
            this.markAllExportsUsed(depModule);
          } else if (usedNames.has(spec.local) || module.isEntry || module.isDynamicEntry) {
            if (spec.imported === 'default') {
              depModule.usedExports.add('default');
            } else if (spec.imported === '*') {
              this.markAllExportsUsed(depModule);
            } else {
              depModule.usedExports.add(spec.imported);
            }
          }
        }

        const depHasUnused = depModule.exports.some(e =>
          e.name !== '*' && !depModule.usedExports.has(e.name)
        );

        if (depHasUnused && depModule.usedExports.size > 0) {
          this.markModuleExportsUsed(depModule, new Set(visited));
        }
      }
    }
  }

  markAllExportsUsed(module) {
    if (!module) return;
    for (const exp of module.exports) {
      if (exp.name !== '*') {
        module.usedExports.add(exp.name);
      } else if (exp.source) {
        const resolved = this.moduleGraph.parser.resolve(exp.source, module.filePath);
        const depModule = this.moduleGraph.getModule(resolved);
        if (depModule) {
          this.markAllExportsUsed(depModule);
        }
      }
    }
  }

  checkModuleSideEffects(module) {
    if (!this.sideEffects) return false;
    if (!module.parsed) return true;

    const source = module.parsed.source;
    const ast = module.parsed.ast;
    const self = this;

    if (module.imports && module.imports.some(imp => imp.source.endsWith('.css'))) {
      return true;
    }

    let hasSideEffect = false;

    traverse(ast, {
      Program(path) {
        for (const stmt of path.node.body) {
          if (t.isImportDeclaration(stmt)) continue;
          if (t.isExportDeclaration(stmt) && !stmt.declaration) continue;

          if (self.hasSideEffect(stmt)) {
            hasSideEffect = true;
            break;
          }
        }
      }
    });

    return hasSideEffect;
  }

  hasSideEffect(node) {
    if (t.isExpressionStatement(node)) {
      return this.hasExpressionSideEffect(node.expression);
    }

    if (t.isVariableDeclaration(node)) {
      for (const decl of node.declarations) {
        if (decl.init && this.hasExpressionSideEffect(decl.init)) {
          return true;
        }
      }
      return false;
    }

    if (t.isFunctionDeclaration(node) || t.isClassDeclaration(node)) {
      return false;
    }

    if (t.isExportNamedDeclaration(node) && node.declaration) {
      return this.hasSideEffect(node.declaration);
    }

    if (t.isExportDefaultDeclaration(node) && node.declaration) {
      if (t.isFunctionDeclaration(node.declaration) || t.isClassDeclaration(node.declaration)) {
        return false;
      }
      if (t.isExpression(node.declaration)) {
        return this.hasExpressionSideEffect(node.declaration);
      }
    }

    return true;
  }

  hasExpressionSideEffect(expr) {
    if (t.isCallExpression(expr) || t.isNewExpression(expr)) {
      return true;
    }

    if (t.isAssignmentExpression(expr) || t.isUpdateExpression(expr)) {
      return true;
    }

    if (t.isMemberExpression(expr)) {
      return this.hasExpressionSideEffect(expr.object);
    }

    if (t.isBinaryExpression(expr) || t.isLogicalExpression(expr)) {
      return this.hasExpressionSideEffect(expr.left) || this.hasExpressionSideEffect(expr.right);
    }

    if (t.isUnaryExpression(expr)) {
      return this.hasExpressionSideEffect(expr.argument);
    }

    if (t.isConditionalExpression(expr)) {
      return this.hasExpressionSideEffect(expr.test) ||
             this.hasExpressionSideEffect(expr.consequent) ||
             this.hasExpressionSideEffect(expr.alternate);
    }

    if (t.isSequenceExpression(expr)) {
      return expr.expressions.some(e => this.hasExpressionSideEffect(e));
    }

    if (t.isLiteral(expr) || t.isIdentifier(expr) || t.isThisExpression(expr)) {
      return false;
    }

    if (t.isFunctionExpression(expr) || t.isArrowFunctionExpression(expr) || t.isClassExpression(expr)) {
      return false;
    }

    if (t.isObjectExpression(expr)) {
      return expr.properties.some(prop => {
        if (t.isSpreadElement(prop)) {
          return this.hasExpressionSideEffect(prop.argument);
        }
        if (t.isObjectMethod(prop)) {
          return false;
        }
        return this.hasExpressionSideEffect(prop.value);
      });
    }

    if (t.isArrayExpression(expr)) {
      return expr.elements.some(el => el && this.hasExpressionSideEffect(el));
    }

    if (t.isTemplateLiteral(expr)) {
      return expr.expressions.some(e => this.hasExpressionSideEffect(e));
    }

    return true;
  }

  analyzeSideEffects() {
    const modules = this.moduleGraph.getAllModules();
    for (const module of modules) {
      module.sideEffects = this.checkModuleSideEffects(module);
    }
    return this;
  }

  eliminateDeadCode() {
    const modules = this.moduleGraph.getAllModules();

    for (const module of modules) {
      if (!module.parsed) continue;

      const source = module.parsed.source;
      const s = new MagicString(source);
      const removedRanges = [];

      for (const exp of module.exports) {
        if (exp.name === '*') continue;
        if (module.usedExports.has(exp.name)) continue;

        if (exp.type === 'default' && exp.declarationType === 'expression') {
          removedRanges.push([exp.start, exp.end]);
        } else if (exp.type === 'named' && exp.declarationType === 'variable') {
          if (exp.declarationStart !== undefined && exp.declarationEnd !== undefined) {
            removedRanges.push([exp.declarationStart, exp.declarationEnd]);
          }
        } else if (exp.type === 'named' && (exp.declarationType === 'FunctionDeclaration' || exp.declarationType === 'ClassDeclaration')) {
          if (exp.declarationStart !== undefined && exp.declarationEnd !== undefined) {
            removedRanges.push([exp.declarationStart, exp.declarationEnd]);
          }
        } else if (exp.type === 'named' && exp.declarationType === 're-export') {
          removedRanges.push([exp.start, exp.end]);
        } else if (exp.type === 'default' && exp.declarationName) {
          const isUsed = module.usedExports.has(exp.declarationName);
          if (!isUsed && exp.declarationStart !== undefined && exp.declarationEnd !== undefined) {
            removedRanges.push([exp.declarationStart, exp.declarationEnd]);
          } else if (!isUsed) {
            removedRanges.push([exp.start, exp.end]);
          }
        }
      }

      for (const imp of module.parsed.imports) {
        const resolved = this.moduleGraph.parser.resolve(imp.source, module.filePath);
        const depModule = this.moduleGraph.getModule(resolved);

        if (!depModule) continue;

        const usedSpecifiers = imp.specifiers.filter(spec => {
          if (spec.type === 'ImportNamespaceSpecifier') return true;

          const imported = spec.imported;
          const local = spec.local;

          if (module.usedExports.has(local)) return true;
          if (module.sideEffects) return true;
          if (module.isEntry || module.isDynamicEntry) return true;

          if (imported === 'default' && depModule.usedExports.has('default')) return true;
          if (imported !== 'default' && depModule.usedExports.has(imported)) return true;

          return false;
        });

        if (usedSpecifiers.length === 0) {
          removedRanges.push([imp.start, imp.end]);
        } else if (usedSpecifiers.length < imp.specifiers.length) {
          imp.specifiers = usedSpecifiers;
        }
      }

      removedRanges.sort((a, b) => b[0] - a[0]);

      for (const [start, end] of removedRanges) {
        s.remove(start, end);
      }

      module.optimizedSource = s.toString();
      module.magicString = s;
      module.removedRanges = removedRanges;
    }

    return this;
  }

  getUnusedExports(module) {
    if (!module) return [];
    return module.exports.filter(e =>
      e.name !== '*' && !module.usedExports.has(e.name)
    );
  }

  getUsedExports(module) {
    if (!module) return [];
    return module.exports.filter(e =>
      e.name === '*' || module.usedExports.has(e.name)
    );
  }

  canEliminateModule(module) {
    if (!module) return false;
    if (module.isEntry || module.isDynamicEntry) return false;
    if (module.sideEffects) return false;
    if (module.usedExports.size > 0 && !module.usedExports.has('__side_effects__')) return false;
    if (module.usedExports.has('__side_effects__') && module.usedExports.size > 1) return false;
    return true;
  }
}

module.exports = Optimizer;
