import * as fs from 'fs'
import * as path from 'path'
import wp from 'webpack'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

import { AngularWebpackPlugin } from '@ngtools/webpack'
import { createEs2015LinkerPlugin } from '@angular/compiler-cli/linker/babel'
import * as sass from 'sass'
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

export default () => {
    const isDev = !!process.env.TABBY_DEV
    const enableCache = !process.env.TABBY_DISABLE_CACHE
    const config = {
        name: 'tabby',
        target: 'node',
        entry: {
            'index.ignore': 'file-loader?name=index.html!pug-html-loader!' + path.resolve(__dirname, './index.pug'),
            bridge: path.resolve(__dirname, 'src/bridge.preload.ts'),
            preload: path.resolve(__dirname, 'src/entry.preload.ts'),
            bundle: path.resolve(__dirname, 'src/entry.ts'),
        },
        mode: isDev ? 'development' : 'production',
        optimization:{
            minimize: false,
            concatenateModules: false,
        },
        cache: enableCache ? {
            type: 'filesystem',
            cacheDirectory: path.resolve(__dirname, 'node_modules', '.webpack-cache'),
            buildDependencies: {
                config: [
                    path.resolve(__dirname, 'webpack.config.mjs'),
                    path.resolve(__dirname, 'tsconfig.json'),
                ],
            },
        } : false,
        performance: isDev ? false : {
            hints: 'warning',
            maxAssetSize: 15 * 1024 * 1024,
            maxEntrypointSize: 20 * 1024 * 1024,
        },
        context: __dirname,
        devtool: 'source-map',
        output: {
            path: path.join(__dirname, 'dist'),
            pathinfo: true,
            filename: '[name].js',
            publicPath: 'auto',
        },
        resolve: {
            modules: ['src/', 'node_modules', '../node_modules', 'assets/'].map(x => path.join(__dirname, x)),
            extensions: ['.ts', '.js'],
        },
        module: {
            rules: [
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
                    use: {
                        loader: '@ngtools/webpack',
                    },
                },
                {
                    test: /\.scss$/,
                    use: [
                        'style-loader',
                        'css-loader',
                        {
                            loader: 'sass-loader',
                            options: {
                                implementation: sass,
                                sassOptions: {
                                    quietDeps: true,
                                },
                            },
                        },
                    ],
                },
                { test: /\.css$/, use: ['style-loader', 'css-loader'] },
                {
                    test: /\.(png|svg|ttf|eot|otf|woff|woff2)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
                    type: 'asset',
                },
            ],
        },
        externals: {
            '@tabby-gang/windows-blurbehind': 'commonjs @tabby-gang/windows-blurbehind',
            '@tabby-gang/windows-process-tree': 'commonjs @tabby-gang/windows-process-tree',
            'v8-compile-cache': 'commonjs v8-compile-cache',
            child_process: 'commonjs child_process',
            electron: 'commonjs electron',
            'fontmanager-redux': 'commonjs fontmanager-redux',
            fs: 'commonjs fs',
            'macos-native-processlist': 'commonjs macos-native-processlist',
            module: 'commonjs module',
            'native-process-working-directory': 'commonjs native-process-working-directory',
            path: 'commonjs path',
            'windows-native-registry': 'commonjs windows-native-registry',
        },
        plugins: [
            new wp.DefinePlugin({
                'process.type': '"renderer"',
            }),
            new AngularWebpackPlugin({
                tsconfig: path.resolve(__dirname, 'tsconfig.json'),
                directTemplateLoading: false,
                jitMode: true,
            })
        ],
    }

    if (process.env.BUNDLE_ANALYZER) {
        config.plugins.push(new BundleAnalyzerPlugin({ analyzerPort: 0 }))
        config.cache = false
    }

    return config
}
