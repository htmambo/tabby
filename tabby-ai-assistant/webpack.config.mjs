import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

import config from '../webpack.plugin.config.mjs'

export default () => config({
    name: 'ai-assistant',
    dirname: __dirname,
    rules: [
        {
            test: /\.html$/,
            use: ['raw-loader'],
        },
    ],
})
