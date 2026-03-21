import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

import config from '../webpack.plugin.config.mjs'

export default () => {
    const cfg = config({
        name: 'ai-assistant',
        dirname: __dirname,
        rules: [
            {
                test: /\.html$/,
                use: ['raw-loader'],
            },
        ],
    })
    cfg.entry = {
        index: 'src/index.ts',
        'index-minimal': 'src/index-minimal.ts',
    }
    cfg.output.filename = '[name].js'
    return cfg
}
