const { SourceMapGenerator, SourceMapConsumer } = require('source-map');
const path = require('path');

class SourceMapBuilder {
  constructor(options = {}) {
    this.sourceRoot = options.sourceRoot || '';
    this.outputPath = options.outputPath || '';
    this.generators = new Map();
    this.moduleOffsets = new Map();
    this.sourceFileCache = new Map();
  }

  init(chunkId, outputFile) {
    const generator = new SourceMapGenerator({
      file: path.basename(outputFile),
      sourceRoot: this.sourceRoot
    });
    this.generators.set(chunkId, generator);
    return generator;
  }

  setSourceContent(chunkId, sourceFile, content) {
    const generator = this.generators.get(chunkId);
    if (generator) {
      generator.setSourceContent(sourceFile, content);
    }
    this.sourceFileCache.set(sourceFile, content);
  }

  addMapping(chunkId, mapping) {
    const generator = this.generators.get(chunkId);
    if (generator) {
      generator.addMapping({
        generated: {
          line: mapping.generatedLine,
          column: mapping.generatedColumn
        },
        original: mapping.originalLine !== undefined ? {
          line: mapping.originalLine,
          column: mapping.originalColumn
        } : null,
        source: mapping.source,
        name: mapping.name
      });
    }
  }

  trackModuleOffset(chunkId, moduleId, startLine, startColumn, endLine, endColumn) {
    const key = `${chunkId}:${moduleId}`;
    this.moduleOffsets.set(key, {
      startLine,
      startColumn,
      endLine,
      endColumn
    });
  }

  addModuleMappings(chunkId, module, startLine, sourceRoot) {
    const generator = this.generators.get(chunkId);
    if (!generator) return;

    const sourceFile = path.relative(sourceRoot || this.sourceRoot, module.filePath).replace(/\\/g, '/');
    const content = module.optimizedSource || module.parsed?.source || '';

    generator.setSourceContent(sourceFile, content);

    if (!module.parsed || !module.parsed.ast) return;

    const mappings = this.extractMappingsFromAst(module, sourceFile, startLine);

    for (const mapping of mappings) {
      generator.addMapping(mapping);
    }
  }

  extractMappingsFromAst(module, sourceFile, startLine) {
    const mappings = [];
    const ast = module.parsed.ast;

    const traverseNode = (node, lineOffset = 0) => {
      if (!node || typeof node !== 'object') return;

      if (node.loc && node.loc.start && node.loc.end) {
        const originalStartLine = node.loc.start.line;
        const originalStartColumn = node.loc.start.column;
        const generatedStartLine = startLine + lineOffset + (originalStartLine - 1);
        const generatedStartColumn = originalStartColumn;

        let name = null;
        if (node.type === 'Identifier') {
          name = node.name;
        } else if (node.type === 'VariableDeclarator' && node.id && node.id.name) {
          name = node.id.name;
        } else if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') && node.id) {
          name = node.id.name;
        } else if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.id) {
          name = node.id.name;
        }

        mappings.push({
          generated: {
            line: generatedStartLine,
            column: generatedStartColumn
          },
          original: {
            line: originalStartLine,
            column: originalStartColumn
          },
          source: sourceFile,
          name
        });
      }

      for (const key in node) {
        if (key === 'loc' || key === 'parent' || key === 'leadingComments' || key === 'trailingComments') continue;

        const value = node[key];
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const child = value[i];
            if (child && typeof child === 'object' && child.type) {
              const childLineOffset = child.loc ? (child.loc.start.line - 1) - (node.loc ? (node.loc.start.line - 1) : 0) : 0;
              traverseNode(child, lineOffset + childLineOffset);
            }
          }
        } else if (value && typeof value === 'object' && value.type) {
          const childLineOffset = value.loc ? (value.loc.start.line - 1) - (node.loc ? (node.loc.start.line - 1) : 0) : 0;
          traverseNode(value, lineOffset + childLineOffset);
        }
      }
    };

    traverseNode(ast);

    return mappings;
  }

  generateMappingsFromSource(source, sourceFile, startLine) {
    const lines = source.split('\n');
    const mappings = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmedLine = lines[i].trim();
      if (trimmedLine && !trimmedLine.startsWith('//') && !trimmedLine.startsWith('/*')) {
        mappings.push({
          generated: {
            line: startLine + i,
            column: 0
          },
          original: {
            line: i + 1,
            column: 0
          },
          source: sourceFile,
          name: null
        });
      }
    }

    return mappings;
  }

  buildSimpleMapping(source, sourceFile, startLine, chunkId) {
    const generator = this.generators.get(chunkId);
    if (!generator) return;

    generator.setSourceContent(sourceFile, source);

    const mappings = this.generateMappingsFromSource(source, sourceFile, startLine);
    for (const mapping of mappings) {
      generator.addMapping(mapping);
    }
  }

  toJSON(chunkId) {
    const generator = this.generators.get(chunkId);
    return generator ? generator.toJSON() : null;
  }

  toString(chunkId) {
    const generator = this.generators.get(chunkId);
    return generator ? generator.toString() : '';
  }

  applySourceMap(chunkId, sourceMap, sourceFile) {
    const generator = this.generators.get(chunkId);
    if (!generator || !sourceMap) return;

    try {
      const consumer = new SourceMapConsumer(sourceMap);
      consumer.eachMapping((mapping) => {
        if (mapping.originalLine !== null) {
          generator.addMapping({
            generated: {
              line: mapping.generatedLine,
              column: mapping.generatedColumn
            },
            original: {
              line: mapping.originalLine,
              column: mapping.originalColumn
            },
            source: sourceFile || mapping.source,
            name: mapping.name
          });
        }
      });
    } catch (e) {
      console.warn(`Failed to apply source map: ${e.message}`);
    }
  }

  getModuleOffset(chunkId, moduleId) {
    const key = `${chunkId}:${moduleId}`;
    return this.moduleOffsets.get(key);
  }

  merge(chunkId, otherBuilder) {
    const generator = this.generators.get(chunkId);
    const otherGenerator = otherBuilder.generators.get(chunkId);

    if (generator && otherGenerator) {
      const otherMap = otherGenerator.toJSON();
      for (const source of otherMap.sources) {
        const content = otherMap.sourcesContent[otherMap.sources.indexOf(source)];
        if (content !== undefined) {
          generator.setSourceContent(source, content);
        }
      }

      try {
        const consumer = new SourceMapConsumer(otherMap);
        consumer.eachMapping((mapping) => {
          if (mapping.originalLine !== null) {
            generator.addMapping({
              generated: {
                line: mapping.generatedLine,
                column: mapping.generatedColumn
              },
              original: {
                line: mapping.originalLine,
                column: mapping.originalColumn
              },
              source: mapping.source,
              name: mapping.name
            });
          }
        });
      } catch (e) {
        console.warn(`Failed to merge source map: ${e.message}`);
      }
    }
  }

  static encodeVLQ(value) {
    const VLQ_BASE_SHIFT = 5;
    const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
    const VLQ_MASK = VLQ_BASE - 1;
    const VLQ_CONTINUATION_BIT = VLQ_BASE;
    const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    let encoded = '';
    let digit;
    let vlq = value < 0 ? ((-value) << 1) + 1 : value << 1;

    do {
      digit = vlq & VLQ_MASK;
      vlq >>>= VLQ_BASE_SHIFT;
      if (vlq > 0) {
        digit |= VLQ_CONTINUATION_BIT;
      }
      encoded += BASE64_CHARS[digit];
    } while (vlq > 0);

    return encoded;
  }

  static encodeMappings(mappings) {
    let result = '';
    let previousGeneratedLine = 1;
    let previousGeneratedColumn = 0;
    let previousSourceIndex = 0;
    let previousOriginalLine = 0;
    let previousOriginalColumn = 0;
    let previousNameIndex = 0;

    for (const lineMappings of mappings) {
      if (result.length > 0) {
        result += ';';
      }

      let firstInLine = true;

      for (const mapping of lineMappings) {
        if (!firstInLine) {
          result += ',';
        }
        firstInLine = false;

        const generatedColumn = mapping.generatedColumn;
        result += this.encodeVLQ(generatedColumn - previousGeneratedColumn);
        previousGeneratedColumn = generatedColumn;

        if (mapping.sourceIndex !== undefined) {
          result += this.encodeVLQ(mapping.sourceIndex - previousSourceIndex);
          previousSourceIndex = mapping.sourceIndex;

          result += this.encodeVLQ(mapping.originalLine - 1 - previousOriginalLine);
          previousOriginalLine = mapping.originalLine - 1;

          result += this.encodeVLQ(mapping.originalColumn - previousOriginalColumn);
          previousOriginalColumn = mapping.originalColumn;

          if (mapping.nameIndex !== undefined) {
            result += this.encodeVLQ(mapping.nameIndex - previousNameIndex);
            previousNameIndex = mapping.nameIndex;
          }
        }
      }

      previousGeneratedColumn = 0;
    }

    return result;
  }

  static decodeVLQ(encoded, index = 0) {
    const VLQ_BASE_SHIFT = 5;
    const VLQ_BASE = 1 << VLQ_BASE_SHIFT;
    const VLQ_MASK = VLQ_BASE - 1;
    const VLQ_CONTINUATION_BIT = VLQ_BASE;
    const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const BASE64_MAP = {};
    for (let i = 0; i < BASE64_CHARS.length; i++) {
      BASE64_MAP[BASE64_CHARS[i]] = i;
    }

    let result = 0;
    let shift = 0;
    let continuation;
    let digit;

    do {
      digit = BASE64_MAP[encoded[index++]];
      continuation = digit & VLQ_CONTINUATION_BIT;
      digit &= VLQ_MASK;
      result += digit << shift;
      shift += VLQ_BASE_SHIFT;
    } while (continuation);

    const value = result & 1 ? -(result >> 1) : result >> 1;
    return { value, index };
  }
}

module.exports = SourceMapBuilder;
