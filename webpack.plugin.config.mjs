import * as fs from 'fs'
import * as path from 'path'
import wp from 'webpack'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import { AngularWebpackPlugin } from '@ngtools/webpack'
import * as url from 'url'
import * as vars from './scripts/vars.mjs'

const bundleAnalyzer = new BundleAnalyzerPlugin({
    analyzerPort: 0,
})
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

import { createEs2015LinkerPlugin } from '@angular/compiler-cli/linker/babel'
const linkerPlugin = createEs2015LinkerPlugin({
    linkerJitMode: true,
    fileSystem: {
        resolve: path.resolve,
        exists: fs.existsSync,
        dirname: path.dirname,
        relative: path.relative,
        readFile: fs.readFileSync,
    },
})

export default options => {
    const isDev = !!process.env.TABBY_DEV
    const enableCache = !process.env.TABBY_DISABLE_CACHE
    const emitSourceMaps = isDev || !!process.env.CI || !!process.env.TABBY_RELEASE_SOURCEMAPS
    const enableSourceMapLoader = !process.env.TABBY_SKIP_SOURCE_MAP_LOADER
    const sassLoader = {
        loader: 'sass-loader',
        options: {
            sassOptions: {
                quietDeps: true,
            },
        },
    }
    const sourceMapOptions = {
        exclude: [/node_modules/, /vendor/],
        filename: '[file].map',
        moduleFilenameTemplate: `webpack-tabby-${options.name}:///[resource-path]`,
    }
    let devtoolPlugin = wp.SourceMapDevToolPlugin

    if (process.env.CI) {
        sourceMapOptions.append = '\n//# sourceMappingURL=../../../app.asar.unpacked/assets/webpack/[url]'
    }

    if ((process.platform === 'win32' || process.platform === 'linux') && process.env.TABBY_DEV) {
        devtoolPlugin = wp.EvalSourceMapDevToolPlugin
    }

    const cacheConfig = enableCache ? {
        type: 'filesystem',
        cacheDirectory: path.resolve(options.dirname, 'node_modules', '.webpack-cache'),
        version: vars.version,
        buildDependencies: {
            config: [
                path.resolve(__dirname, 'webpack.plugin.config.mjs'),
                path.resolve(options.dirname, 'tsconfig.json'),
            ],
        },
    } : false
    const config = {
        target: 'node',
        entry: 'src/index.ts',
        context: options.dirname,
        devtool: false,
        output: {
            path: path.resolve(options.dirname, 'dist'),
            filename: 'index.js',
            pathinfo: isDev,
            libraryTarget: 'umd',
            publicPath: 'auto',
        },
        mode: isDev ? 'development' : 'production',
        optimization:{
            minimize: !isDev,
            concatenateModules: !isDev,
        },
        cache: cacheConfig,
        performance: isDev ? false : {
            hints: 'warning',
            maxAssetSize: 15 * 1024 * 1024,
            maxEntrypointSize: 20 * 1024 * 1024,
        },
        resolve: {
            alias: options.alias ?? {},
            modules: ['.', 'src', 'node_modules', '../app/node_modules', '../node_modules'].map(x => path.join(options.dirname, x)),
            extensions: ['.ts', '.js'],
            aliasFields: [],
            conditionNames: ['node', 'import', 'require', 'default'],
            mainFields: options.mainFields ?? ['esm2015', 'module', 'main'],
        },
        ignoreWarnings: [/Failed to parse source map/],
        module: {
            rules: [
                ...(options.rules ?? []),
                ...(enableSourceMapLoader ? [{
                    test: /\.js$/,
                    enforce: 'pre',
                    use: {
                        loader: 'source-map-loader',
                        options: {
                            filterSourceMappingUrl: (url, resourcePath) => {
                                if (/node_modules/.test(resourcePath) && !resourcePath.includes('xterm')) {
                                    return false
                                }
                                return true
                            },

                        },
                    },
                }] : []),
                {
                    test: /\.(m?)js$/,
                    loader: 'babel-loader',
                    options: {
                        plugins: [linkerPlugin],
                        compact: false,
                        cacheDirectory: true,
                    },
                    resolve: {
                        fullySpecified: false,
                    },
                },
                {
                    test: /\.ts$/,
                    use: [
                        {
                            loader: '@ngtools/webpack',
                        },
                    ],
                },
                {
                    test: /\.pug$/,
                    use: [
                        'apply-loader',
                        {
                            loader: 'pug-loader',
                            options: {
                                pretty: true,
                            },
                        },
                    ],
                },
                { test: /\.scss$/, use: ['@tabby-gang/to-string-loader', 'css-loader', sassLoader], include: /(theme.*|component)\.scss/ },
                { test: /\.scss$/, use: ['style-loader', 'css-loader', sassLoader], exclude: /(theme.*|component)\.scss/ },
                { test: /\.css$/, use: ['@tabby-gang/to-string-loader', 'css-loader'], include: /component\.css/ },
                { test: /\.css$/, use: ['style-loader', 'css-loader'], exclude: /component\.css/ },
                { test: /\.yaml$/, use: ['yaml-loader'] },
                { test: /\.svg/, use: ['svg-inline-loader'] },
                {
                    test: /\.(eot|otf|woff|woff2|ogg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
                    type: 'asset',
                },
                {
                    test: /\.ttf$/,
                    type: 'asset/inline',
                },
                {
                    test: /\.po$/,
                    use: [
                        { loader: 'json-loader' },
                        { loader: 'po-gettext-loader' },
                    ],
                },
            ],
        },
        externals: [
            '@electron/remote',
            '@serialport/bindings',
            '@serialport/bindings-cpp',
            'any-promise',
            'child_process',
            'electron-promise-ipc',
            'electron-updater',
            'electron',
            'fontmanager-redux',
            'fs',
            'keytar',
            'macos-native-processlist',
            'native-process-working-directory',
            'net',
            'ngx-toastr',
            'os',
            'path',
            'readline',
            'russh',
            '@luminati-io/socksv5',
            'stream',
            'windows-native-registry',
            '@tabby-gang/windows-process-tree',
            '@tabby-gang/windows-process-tree/build/Release/windows_process_tree.node',
            /^@angular(?!\/common\/locales)/,
            /^@ng-bootstrap/,
            /^rxjs/,
            /^tabby-/,
            ...(options.externals || []),
        ],
        plugins: [
            ...(emitSourceMaps ? [new devtoolPlugin(sourceMapOptions)] : []),
            new wp.DefinePlugin({
                __TABBY_BUILD_VERSION__: JSON.stringify(vars.version),
            }),
            new AngularWebpackPlugin({
                tsconfig: path.resolve(options.dirname, 'tsconfig.json'),
                directTemplateLoading: false,
                jitMode: true,
            })
        ],
    }
    if (process.env.PLUGIN_BUNDLE_ANALYZER === options.name) {
        config.plugins.push(bundleAnalyzer)
        config.cache = false
    }
    return config
}
