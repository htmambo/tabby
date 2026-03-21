import * as path from 'path'
import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

import config from '../webpack.plugin.config.mjs'

export default () => {
    const cfg = config({
        name: 'plugin-manager',
        dirname: __dirname,
    })
    cfg.entry = {
        index: 'src/index.ts',
        'index-minimal': 'src/index-minimal.ts',
    }
    cfg.output.filename = '[name].js'
    return cfg
}
