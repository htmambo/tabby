"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pluginManager = exports.PluginManager = void 0;
const util_1 = require("util");
class PluginManager {
    async ensureLoaded() {
        if (!this.npmReady) {
            this.npmReady = new Promise(resolve => {
                const npm = require('npm');
                npm.load((err) => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    npm.config.set('global', false);
                    this.npm = npm;
                    resolve();
                });
            });
        }
        return this.npmReady;
    }
    async install(path, name, version) {
        await this.ensureLoaded();
        this.npm.prefix = path;
        return (0, util_1.promisify)(this.npm.commands.install)([`${name}@${version}`]);
    }
    async uninstall(path, name) {
        await this.ensureLoaded();
        this.npm.prefix = path;
        return (0, util_1.promisify)(this.npm.commands.remove)([name]);
    }
}
exports.PluginManager = PluginManager;
exports.pluginManager = new PluginManager();
//# sourceMappingURL=pluginManager.js.map