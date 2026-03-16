"use strict";
var _a, _b;
var _c, _d;
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// set userData Path on portable version
require("./portable");
// set defaults of environment variables
require("dotenv/config");
(_a = (_c = process.env).TABBY_PLUGINS) !== null && _a !== void 0 ? _a : (_c.TABBY_PLUGINS = '');
(_b = (_d = process.env).TABBY_CONFIG_DIRECTORY) !== null && _b !== void 0 ? _b : (_d.TABBY_CONFIG_DIRECTORY = electron_1.app.getPath('userData'));
require("v8-compile-cache");
require("source-map-support/register");
require("./sentry");
require("./lru");
const cli_1 = require("./cli");
const app_1 = require("./app");
const config_1 = require("./config");
const argv = (0, cli_1.parseArgs)(process.argv, process.cwd());
// eslint-disable-next-line @typescript-eslint/init-declarations
let configStore;
try {
    configStore = (0, config_1.loadConfig)();
}
catch (err) {
    electron_1.dialog.showErrorBox('Could not read config', err.message);
    electron_1.app.exit(1);
}
process.mainModule = module;
const application = new app_1.Application(configStore);
// Register tabby:// URL scheme
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        electron_1.app.setAsDefaultProtocolClient('tabby', process.execPath, [process.argv[1]]);
    }
}
else {
    electron_1.app.setAsDefaultProtocolClient('tabby');
}
electron_1.ipcMain.on('app:new-window', () => {
    application.newWindow();
});
process.on('uncaughtException', (err) => {
    console.error(err);
    application.broadcast('uncaughtException', err);
});
electron_1.app.on('activate', async () => {
    if (!application.hasWindows()) {
        application.newWindow();
    }
    else {
        application.focus();
    }
});
// Handle URL scheme on macOS
electron_1.app.on('open-url', async (event, url) => {
    event.preventDefault();
    console.debug('Received open-url event:', url);
    if (!application.hasWindows()) {
        process.argv.push(url);
    }
    else {
        await electron_1.app.whenReady();
        application.handleSecondInstance([url], process.cwd());
    }
});
electron_1.app.on('second-instance', async (_event, newArgv, cwd) => {
    application.handleSecondInstance(newArgv, cwd);
});
if (!electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
    electron_1.app.exit(0);
}
electron_1.app.on('ready', async () => {
    if (process.platform === 'darwin') {
        electron_1.app.dock.setMenu(electron_1.Menu.buildFromTemplate([
            {
                label: 'New window',
                click() {
                    this.app.newWindow();
                },
            },
        ]));
    }
    application.init();
    const window = await application.newWindow({ hidden: argv.hidden, debug: argv.d });
    await window.ready;
    window.passCliArguments(process.argv, process.cwd(), false);
    window.focus();
});
//# sourceMappingURL=index.js.map