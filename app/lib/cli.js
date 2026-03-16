"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createParserConfig = createParserConfig;
exports.parseArgs = parseArgs;
const electron_1 = require("electron");
function createParserConfig(cwd) {
    return {
        usage: 'tabby [command] [arguments]',
        commands: [
            {
                command: 'open [directory]',
                description: 'open a shell in a directory',
                options: {
                    directory: { type: 'string', 'default': cwd },
                },
            },
            {
                command: ['run [command...]', '/k'],
                description: 'run a command in the terminal',
                options: {
                    command: { type: 'array' },
                },
            },
            {
                command: 'profile [profileName]',
                description: 'open a tab with specified profile',
                options: {
                    profileName: { type: 'string' },
                },
            },
            {
                command: 'paste [text]',
                description: 'paste stdin into the active tab',
                options: {
                    escape: {
                        alias: 'e',
                        type: 'boolean',
                        describe: 'Perform shell escaping',
                    },
                },
                positionals: {
                    text: { type: 'string' },
                },
            },
            {
                command: 'recent [index]',
                description: 'open a tab with a recent profile',
                options: {
                    profileNumber: { type: 'number' },
                },
            },
            {
                command: 'quickConnect <providerId> <query>',
                description: 'open a tab for specified quick connect provider',
                positionals: {
                    providerId: {
                        describe: 'The name of a quick connect profile provider',
                        type: 'string',
                    },
                    query: {
                        describe: 'The quick connect query string',
                        type: 'string',
                    },
                },
            },
        ],
        options: {
            debug: {
                alias: 'd',
                describe: 'Show DevTools on start',
                type: 'boolean',
            },
            hidden: {
                describe: 'Start minimized',
                type: 'boolean',
            },
        },
        version: electron_1.app.getVersion(),
    };
}
function applyOptionsToYargs(yargsInstance, options, method) {
    return Object.entries(options).reduce((yargs, [key, value]) => yargs[method](key, value), yargsInstance);
}
function createParserFromConfig(config) {
    const yargs = require('yargs/yargs');
    let parser = yargs().usage(config.usage);
    config.commands.forEach(cmd => {
        const builder = (yargsInstance) => {
            let instance = yargsInstance;
            if (cmd.options) {
                instance = applyOptionsToYargs(instance, cmd.options, 'option');
            }
            if (cmd.positionals) {
                instance = applyOptionsToYargs(instance, cmd.positionals, 'positional');
            }
            return instance;
        };
        parser = parser.command(cmd.command, cmd.description, builder);
    });
    parser = applyOptionsToYargs(parser, config.options, 'option');
    return parser.version(config.version).help('help');
}
function parseArgs(argv, cwd) {
    const args = argv[0].includes('node') ? argv.slice(2) : argv.slice(1);
    const config = createParserConfig(cwd);
    const parser = createParserFromConfig(config);
    return parser.parse(args);
}
//# sourceMappingURL=cli.js.map