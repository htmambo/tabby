"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTabbyURL = isTabbyURL;
exports.parseTabbyURL = parseTabbyURL;
const cli_1 = require("./cli");
const shell_quote_1 = require("shell-quote");
function isTabbyURL(arg) {
    return arg.toLowerCase().startsWith('tabby://');
}
function parseTabbyURL(url, cwd = process.cwd()) {
    var _a, _b, _c;
    try {
        if (!isTabbyURL(url)) {
            return null;
        }
        // NOTE: the url host may be lowercased (xdg-open), need to use the original command
        const urlInstance = new URL(url);
        const command = urlInstance.host || urlInstance.pathname.replace(/^\/+/, '');
        const config = (0, cli_1.createParserConfig)(cwd);
        const commandConfig = config.commands.find(cmd => {
            const primaryCommand = Array.isArray(cmd.command) ? cmd.command[0] : cmd.command;
            return command.toLowerCase() === primaryCommand.split(/\s+/)[0].toLowerCase();
        });
        if (!commandConfig) {
            console.error(`Unknown command in tabby:// URL: ${command}`);
            return null;
        }
        const primaryCommand = Array.isArray(commandConfig.command) ? commandConfig.command[0] : commandConfig.command;
        const actualCommand = primaryCommand.split(/\s+/)[0];
        const argv = {
            _: [actualCommand],
        };
        for (const [key, value] of urlInstance.searchParams.entries()) {
            let parsedValue = value;
            const optionConfig = (_b = (_a = commandConfig.options) === null || _a === void 0 ? void 0 : _a[key]) !== null && _b !== void 0 ? _b : (_c = commandConfig.positionals) === null || _c === void 0 ? void 0 : _c[key];
            if (optionConfig) {
                switch (optionConfig.type) {
                    case 'boolean':
                        parsedValue = value === 'true' || value === '';
                        break;
                    case 'number':
                        parsedValue = parseInt(value, 10);
                        break;
                    case 'array':
                        parsedValue = (0, shell_quote_1.parse)(value).filter((item) => typeof item === 'string');
                        break;
                    case 'string':
                    default:
                        parsedValue = value;
                        break;
                }
            }
            else {
                parsedValue = value;
            }
            argv[key] = parsedValue;
        }
        console.debug(`URL Handler - Safely parsed [${url}] to:`, JSON.stringify(argv));
        return argv;
    }
    catch (e) {
        console.error('Failed to parse tabby:// URL:', e);
        return null;
    }
}
//# sourceMappingURL=urlHandler.js.map