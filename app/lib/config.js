"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.configPath = void 0;
exports.migrateConfig = migrateConfig;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
const atomically_1 = require("atomically");
exports.configPath = path.join(process.env.TABBY_CONFIG_DIRECTORY, 'config.yaml');
const legacyConfigPath = path.join(process.env.TABBY_CONFIG_DIRECTORY, '../terminus', 'config.yaml');
function migrateConfig() {
    if (fs.existsSync(legacyConfigPath) && (!fs.existsSync(exports.configPath) ||
        fs.statSync(exports.configPath).mtime < fs.statSync(legacyConfigPath).mtime)) {
        fs.writeFileSync(exports.configPath, fs.readFileSync(legacyConfigPath, 'utf8'), 'utf8');
    }
}
function loadConfig() {
    migrateConfig();
    if (fs.existsSync(exports.configPath)) {
        return yaml.load(fs.readFileSync(exports.configPath, 'utf8'));
    }
    else {
        return {};
    }
}
async function saveConfig(content) {
    await (0, atomically_1.writeFile)(exports.configPath, content, { encoding: 'utf8' });
    await (0, atomically_1.writeFile)(exports.configPath + '.backup', content, { encoding: 'utf8' });
}
//# sourceMappingURL=config.js.map