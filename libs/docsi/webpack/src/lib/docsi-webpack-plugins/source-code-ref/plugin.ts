import * as Path from 'path';

import * as webpack from 'webpack';
import * as sources from 'webpack-sources';

const { ConcatSource, OriginalSource } = sources;
const { util: { createHash } } = webpack as any;

import { NS } from '../../unique-symbol';
import { SourceCodeRefDependency, SourceCodeRefDependencyTemplate, SourceCodeRefModule, SourceCodeRefModuleFactory } from './models';

declare module '../metadata-file-emitter/plugin' {
  interface DocsiMetadata {
    extractCodeParts: { [key: string]: string };
  }
}

const pluginName = 'docsi-source-code-ref-webpack-plugin';

class DocsiSourceCodeRefModuleIndexer {
  private cache = new Map<string, { hash: string; module: SourceCodeRefModule }>();

  updateOrCreate(module: SourceCodeRefModule): { hash: string; module: SourceCodeRefModule } {
    let cached = this.cache.get(module._identifier);
    if (!cached) {
      this.cache.set(module._identifier, cached = {
        hash: module.hash,
        module: module
      });
    } else {
      cached.module = module;
    }
    return cached;
  }

  toAsset(filenameGenerator: DocsiSourceCodeRefWebpackPlugin['filenameGenerator']): any {
    const map: any = {};
    for (const c of Array.from(this.cache.values())) {
      map[c.hash] = filenameGenerator(c.module);
    }
    return map;
  }
}

export interface DocsiSourceCodeRefWebpackPluginOptions { }

export class DocsiSourceCodeRefWebpackPlugin implements webpack.Plugin {
  private moduleIndex = new DocsiSourceCodeRefModuleIndexer();
  private compilation: webpack.compilation.Compilation;
  private extractedCodeModuleFactory = new SourceCodeRefModuleFactory();

  private options: DocsiSourceCodeRefWebpackPluginOptions;
  private filenameGenerator: (module: SourceCodeRefModule) => string
    = (module: SourceCodeRefModule): string => `${module.hash}-${Path.basename(module.resourcePath)}.json`;

  constructor(options?: DocsiSourceCodeRefWebpackPluginOptions) {
    this.options = { };
    Object.assign(this.options, options || {});
  }

  apply(compiler: webpack.Compiler): void {

    compiler.hooks.docsiMetadataNotifier.tap(pluginName, notifier => {
      notifier('extractCodeParts', { index: {} as any });

      compiler.hooks.compilation.tap(pluginName, (compilation) => {
        this.compilation = compilation;
        compilation.dependencyFactories.set(SourceCodeRefDependency as any, this.extractedCodeModuleFactory as any);
        compilation.dependencyTemplates.set(SourceCodeRefDependency as any, new SourceCodeRefDependencyTemplate() as any);

        compilation.hooks.normalModuleLoader
          .tap(pluginName, (_loaderContext, m) => {
            this.handleNormalModuleLoaderHook(_loaderContext, m)
          } );

        compilation.mainTemplate.hooks.renderManifest
          .tap(pluginName, (result: any[], { chunk }) => this.handleRenderManifestHook(result, chunk) );

        compilation.chunkTemplate.hooks.renderManifest
          .tap(pluginName, (result, { chunk }) => this.handleRenderManifestHook(result, chunk) );
      });

      compiler.hooks.afterCompile.tapPromise(pluginName, () => {
        notifier('extractCodeParts', this.moduleIndex.toAsset(this.filenameGenerator));
        return Promise.resolve();
        // metadata.extractCodeParts = this.moduleIndex.toAsset(this.filenameGenerator);
      });
    });
  }

  handleNormalModuleLoaderHook(loaderContext: webpack.loader.LoaderContext,
                               m: webpack.compilation.Module) {
    loaderContext[NS] = (content) => {
      if (!Array.isArray(content) && content != null) {
        throw new Error(`Exported value was not extracted as an array: ${JSON.stringify(content)}`);
      }
      const identifierCountMap = new Map();
      for (const line of content) {
        if (!line.identifier) {
          line.identifier = m.identifier();
        }
        const count = identifierCountMap.get(line.identifier) || 0;
        const extractedCodeDependency = new SourceCodeRefDependency(line, loaderContext.resourcePath, m.context, count);

        this.extractedCodeModuleFactory.invalidate(extractedCodeDependency);
        const extractedCodeModule = this.extractedCodeModuleFactory.create({ dependencies: [extractedCodeDependency] });
        this.updateAndSetHash(extractedCodeModule);

        m.addDependency(extractedCodeDependency);
        identifierCountMap.set(line.identifier, count + 1);
        return this.moduleIndex.updateOrCreate(extractedCodeModule).hash;
      }
    };
  }

  handleRenderManifestHook(result: any[],
                           chunk: any): void {
    const renderedModules: SourceCodeRefModule[] = Array.from(chunk.modulesIterable)
      .filter( (module: any) => module.type === NS ) as any;

    for (const m of renderedModules) {
      const chunkForPath = Object.create(chunk);
      chunkForPath.id = chunkForPath.name = Path.basename(m.resourcePath);
      if (!m.hash) {
        this.updateAndSetHash(m);
      }

      this.moduleIndex.updateOrCreate(m);

      result.push({
        render: () => this.renderContentAsset(chunk, [ m ]),
        filenameTemplate: this.filenameGenerator(m),
        pathOptions: {
          chunk: chunkForPath,
          contentHashType: NS,
          hash: m.hash,
        },
        identifier: `${m.readableIdentifier(this.compilation.runtimeTemplate.requestShortener)}.${pluginName}.${chunk.id}`,
        hash: m.hash,
      });
    }
  }

  updateAndSetHash(module: SourceCodeRefModule): void {
    const { hashFunction, hashDigest, hashDigestLength } = this.compilation.outputOptions;
    const hash = createHash(hashFunction);
    module.updateHash(hash);
    module.hash = hash.digest(hashDigest).substring(0, hashDigestLength);
  }

  getCssChunkObject(mainChunk) {
    const obj = {};
    for (const chunk of mainChunk.getAllAsyncChunks()) {
      for (const module of chunk.modulesIterable) {
        if (module.type === NS) {
          obj[chunk.id] = 1;
          break;
        }
      }
    }
    return obj;
  }

  renderContentAsset(chunk, modules) {
    const { requestShortener } = this.compilation.runtimeTemplate;

    let usedModules;
    const [chunkGroup] = chunk.groupsIterable;
    if (typeof chunkGroup.getModuleIndex2 === 'function') {
      // Store dependencies for modules
      const moduleDependencies = new Map<any, Set<any>>(modules.map((m) => [m, new Set()]));

      // Get ordered list of modules per chunk group
      // This loop also gathers dependencies from the ordered lists
      // Lists are in reverse order to allow to use Array.pop()
      const modulesByChunkGroup = Array.from(chunk.groupsIterable, (cg) => {
        const sortedModules = modules
          .map((m) => {
            return {
              module: m,
              index: (cg as any).getModuleIndex2(m),
            };
          })
          .filter((item) => item.index !== undefined)
          .sort((a, b) => b.index - a.index)
          .map((item) => item.module);
        for (let i = 0; i < sortedModules.length; i++) {
          const set = moduleDependencies.get(sortedModules[i]);
          for (let j = i + 1; j < sortedModules.length; j++) {
            set.add(sortedModules[j]);
          }
        }

        return sortedModules;
      });

      // set with already included modules in correct order
      usedModules = new Set();

      const unusedModulesFilter = (m) => !usedModules.has(m);

      while (usedModules.size < modules.length) {
        let success = false;
        let bestMatch;
        let bestMatchDeps;
        // get first module where dependencies are fulfilled
        for (const list of modulesByChunkGroup) {
          // skip and remove already added modules
          while (list.length > 0 && usedModules.has(list[list.length - 1]))
            list.pop();

          // skip empty lists
          if (list.length !== 0) {
            const module = list[list.length - 1];
            const deps = moduleDependencies.get(module);
            // determine dependencies that are not yet included
            const failedDeps = Array.from(deps).filter(unusedModulesFilter);

            // store best match for fallback behavior
            if (!bestMatchDeps || bestMatchDeps.length > failedDeps.length) {
              bestMatch = list;
              bestMatchDeps = failedDeps;
            }
            if (failedDeps.length === 0) {
              // use this module and remove it from list
              usedModules.add(list.pop());
              success = true;
              break;
            }
          }
        }

        if (!success) {
          // no module found => there is a conflict
          // use list with fewest failed deps
          // and emit a warning
          const fallbackModule = bestMatch.pop();
          this.compilation.warnings.push(
            new Error(
              `chunk ${chunk.name || chunk.id} [mini-css-extract-plugin]\n` +
                'Conflicting order between:\n' +
                ` * ${fallbackModule.readableIdentifier(requestShortener)}\n` +
                `${bestMatchDeps
                  .map((m) => ` * ${m.readableIdentifier(requestShortener)}`)
                  .join('\n')}`
            )
          );
          usedModules.add(fallbackModule);
        }
      }
    } else {
      // fallback for older webpack versions
      // (to avoid a breaking change)
      // TODO remove this in next mayor version
      // and increase minimum webpack version to 4.12.0
      modules.sort((a, b) => a.index2 - b.index2);
      usedModules = modules;
    }
    const source = new ConcatSource();
    const externalsSource = new ConcatSource();
    for (const m of usedModules) {
      source.add(
        new OriginalSource(
          m.content,
          m.readableIdentifier(requestShortener)
        )
      );
      source.add('\n');
    }
    return new ConcatSource(externalsSource, source);
  }
}
