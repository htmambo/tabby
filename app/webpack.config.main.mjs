import * as path from 'path'
import wp from 'webpack'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const isDev = !!process.env.TABBY_DEV
const enableCache = !process.env.TABBY_DISABLE_CACHE
const fastBuild = !!process.env.TABBY_FAST_BUILD
const emitSourceMaps = isDev || !!process.env.CI || !!process.env.TABBY_RELEASE_SOURCEMAPS

const config = {
    name: 'tabby-main',
    target: 'electron-main',
    entry: {
        main: path.resolve(__dirname, 'lib/index.ts'),
    },
    mode: isDev ? 'development' : 'production',
    context: __dirname,
    devtool: emitSourceMaps ? (isDev ? 'source-map' : 'hidden-source-map') : false,
    output: {
        path: path.join(__dirname, 'dist'),
        pathinfo: isDev,
        filename: '[name].js',
    },
    optimization: {
        minimize: !isDev,
        concatenateModules: !isDev,
    },
    cache: enableCache ? {
        type: 'filesystem',
        cacheDirectory: path.resolve(__dirname, 'node_modules', '.webpack-cache'),
        buildDependencies: {
            config: [
                path.resolve(__dirname, 'webpack.config.main.mjs'),
                path.resolve(__dirname, 'tsconfig.main.json'),
            ],
        },
    } : false,
    performance: isDev ? false : {
        hints: 'warning',
        maxAssetSize: 15 * 1024 * 1024,
        maxEntrypointSize: 20 * 1024 * 1024,
    },
    resolve: {
        modules: ['lib/', 'node_modules', '../node_modules'].map(x => path.join(__dirname, x)),
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: path.resolve(__dirname, 'tsconfig.main.json'),
                        transpileOnly: fastBuild,
                        happyPackMode: fastBuild,
                    },
                },
            },
        ],
    },
    externals: {
        '@tabby-gang/windows-process-tree': 'commonjs @tabby-gang/windows-process-tree',
        '@tabby-gang/windows-process-tree/build/Release/windows_process_tree.node': 'commonjs @tabby-gang/windows-process-tree/build/Release/windows_process_tree.node',
        atomically: 'commonjs atomically',
        'v8-compile-cache': 'commonjs v8-compile-cache',
        'any-promise': 'commonjs any-promise',
        child_process: 'commonjs child_process',
        electron: 'commonjs electron',
        'electron-updater': 'commonjs electron-updater',
        'fontmanager-redux': 'commonjs fontmanager-redux',
        fs: 'commonjs fs',
        glasstron: 'commonjs glasstron',
        'js-yaml': 'commonjs js-yaml',
        keytar: 'commonjs keytar',
        'macos-native-processlist': 'commonjs macos-native-processlist',
        module: 'commonjs module',
        'native-process-working-directory': 'commonjs native-process-working-directory',
        npm: 'commonjs npm',
        'node:os': 'commonjs os',
        'node-pty': 'commonjs node-pty',
        path: 'commonjs path',
        util: 'commonjs util',
        'source-map-support': 'commonjs source-map-support',
        'source-map-support/register': 'commonjs source-map-support/register',
        'windows-swca': 'commonjs windows-swca',
        'windows-native-registry': 'commonjs windows-native-registry',
        '@tabby-gang/windows-blurbehind': 'commonjs @tabby-gang/windows-blurbehind',
        'yargs/yargs': 'commonjs yargs/yargs',
    },
    plugins: [
        new wp.optimize.ModuleConcatenationPlugin(),
        new wp.DefinePlugin({
            'process.type': '"main"',
        }),
    ],
}

if (process.env.BUNDLE_ANALYZER) {
    config.plugins.push(new BundleAnalyzerPlugin())
    config.cache = false
}

export default () => config
