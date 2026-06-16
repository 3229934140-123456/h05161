#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Bundler = require('./bundler');
const BuildCache = require('./cache');

function parseArgs(args) {
  const options = {
    command: null,
    entry: null,
    outputDir: 'dist',
    sourceMap: true,
    treeshake: true,
    splitChunks: true,
    watch: false,
    cache: true,
    clearCache: false,
    filename: '[name].js',
    chunkFilename: '[id].[hash].js',
    publicPath: '/',
    help: false
  };

  let i = 2;
  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case 'build':
        options.command = 'build';
        break;
      case 'watch':
        options.command = 'watch';
        options.watch = true;
        break;
      case 'help':
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--entry':
      case '-e':
        options.entry = args[++i];
        break;
      case '--output-dir':
      case '-o':
        options.outputDir = args[++i];
        break;
      case '--no-source-map':
        options.sourceMap = false;
        break;
      case '--no-treeshake':
        options.treeshake = false;
        break;
      case '--no-split':
        options.splitChunks = false;
        break;
      case '--watch':
      case '-w':
        options.watch = true;
        break;
      case '--no-cache':
        options.cache = false;
        break;
      case '--clear-cache':
        options.clearCache = true;
        break;
      case '--filename':
        options.filename = args[++i];
        break;
      case '--chunk-filename':
        options.chunkFilename = args[++i];
        break;
      case '--public-path':
        options.publicPath = args[++i];
        break;
      default:
        if (!options.entry && !arg.startsWith('-')) {
          options.entry = arg;
        }
        break;
    }
    i++;
  }

  return options;
}

function printHelp() {
  console.log(`
mini-bundler - A lightweight static resource bundler

Usage:
  mini-bundler build [options]
  mini-bundler watch [options]
  mini-bundler --help

Options:
  -e, --entry <file>          Entry file path
  -o, --output-dir <dir>      Output directory (default: dist)
      --no-source-map         Disable source map generation
      --no-treeshake          Disable tree-shaking
      --no-split              Disable code splitting
  -w, --watch                 Watch mode
      --no-cache              Disable build cache
      --clear-cache           Clear build cache before build
      --filename <name>       Output filename template (default: [name].js)
      --chunk-filename <name> Chunk filename template (default: [id].[hash].js)
      --public-path <path>    Public path for assets (default: /)
  -h, --help                  Show this help message

Examples:
  mini-bundler build --entry src/index.js --output-dir dist
  mini-bundler watch -e src/main.js -o public/js
  mini-bundler build --no-treeshake --no-split -e app.js
`);
}

async function runBuild(options) {
  if (options.clearCache) {
    const cache = new BuildCache();
    cache.clear();
    console.log('Cache cleared.');
  }

  const bundler = new Bundler(options);
  let cache = null;

  if (options.cache) {
    cache = new BuildCache();
    cache.load();
  }

  try {
    const result = await bundler.build();

    if (options.cache && cache) {
      const modules = bundler.moduleGraph.getAllModules();
      for (const module of modules) {
        cache.updateFileInfo(module.filePath);
      }
      cache.save();
    }

    console.log('\n=== Build Stats ===');
    console.log(`Modules: ${result.stats.moduleCount}`);
    console.log(`Chunks: ${result.stats.chunkCount}`);
    console.log(`Entries: ${result.stats.entryCount}`);
    if (result.stats.cycles > 0) {
      console.log(`Cyclic dependencies: ${result.stats.cycles}`);
    }
    console.log(`Original size: ${result.stats.totalOriginalSize} bytes`);
    console.log(`Optimized size: ${result.stats.totalOptimizedSize} bytes`);
    if (result.stats.treeshakingSaved > 0) {
      console.log(`Tree-shaking saved: ${result.stats.treeshakingSaved} bytes`);
    }

    return result;
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

function runWatch(options) {
  options.watch = true;
  let bundler = null;
  let cache = new BuildCache();

  const build = async () => {
    console.log('\n=== Starting build ===');
    try {
      if (!bundler) {
        bundler = new Bundler(options);
        cache.load();
        const result = await bundler.build();

        const modules = bundler.moduleGraph.getAllModules();
        for (const module of modules) {
          cache.updateFileInfo(module.filePath);
        }
        cache.save();

        console.log('Build completed. Watching for changes...');
        return result;
      } else {
        const incrementalResult = cache.incrementalBuild(bundler);
        if (incrementalResult && !incrementalResult.skipped) {
          const result = await bundler.build();

          for (const moduleId of incrementalResult.changed) {
            cache.updateFileInfo(moduleId);
          }
          for (const moduleId of incrementalResult.affected) {
            cache.invalidateModule(moduleId);
          }
          cache.save();

          console.log('Rebuild completed.');
          return result;
        }
      }
    } catch (error) {
      console.error(`Build failed: ${error.message}`);
      console.error(error.stack);
    }
  };

  build();

  const watchedFiles = new Set();

  const watchFiles = () => {
    if (bundler && bundler.moduleGraph) {
      const modules = bundler.moduleGraph.getAllModules();
      for (const module of modules) {
        if (!watchedFiles.has(module.filePath)) {
          watchedFiles.add(module.filePath);
          fs.watch(module.filePath, { persistent: true }, (event, filename) => {
            if (event === 'change') {
              console.log(`\nFile changed: ${filename}`);
              build();
            }
          });
        }
      }
    }
  };

  setInterval(watchFiles, 1000);

  console.log('Watch mode started. Press Ctrl+C to exit.');
}

async function main() {
  const options = parseArgs(process.argv);

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.entry) {
    const pkgPath = path.resolve('package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.main) {
        options.entry = pkg.main;
      } else if (pkg.module) {
        options.entry = pkg.module;
      }
    }

    if (!options.entry) {
      console.error('Error: No entry file specified. Use --entry <file> or set "main" in package.json.');
      printHelp();
      process.exit(1);
    }
  }

  if (!options.command) {
    options.command = 'build';
  }

  switch (options.command) {
    case 'build':
      await runBuild(options);
      break;
    case 'watch':
      runWatch(options);
      break;
    default:
      console.error(`Unknown command: ${options.command}`);
      printHelp();
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  runBuild,
  runWatch,
  main
};
