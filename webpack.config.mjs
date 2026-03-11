import log from 'npmlog'
import { buildablePackages, resolvePackageRelativePath } from './scripts/vars.mjs'

const paths = [
    './app/webpack.config.mjs',
    './app/webpack.config.main.mjs',
    ...buildablePackages.map(x => `./${resolvePackageRelativePath(x, 'webpack.config.mjs')}`),
]

paths.forEach(x => log.info(`Using config: ${x}`))

export default () => Promise.all(paths.map(x => import(x).then(x => x.default())))
