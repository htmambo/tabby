"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UTF8Splitter = void 0;
const partials = [
    [0b110, 5, 0],
    [0b1110, 4, 1],
    [0b11110, 3, 2],
];
class UTF8Splitter {
    constructor() {
        this.internal = Buffer.alloc(0);
    }
    write(data) {
        this.internal = Buffer.concat([this.internal, data]);
        let keep = 0;
        for (const [pattern, shift, maxOffset] of partials) {
            for (let offset = 0; offset < maxOffset + 1; offset++) {
                if (this.internal[this.internal.length - offset - 1] >> shift === pattern) {
                    keep = Math.max(keep, offset + 1);
                }
            }
        }
        const result = this.internal.slice(0, this.internal.length - keep);
        this.internal = this.internal.slice(this.internal.length - keep);
        return result;
    }
    flush() {
        const result = this.internal;
        this.internal = Buffer.alloc(0);
        return result;
    }
}
exports.UTF8Splitter = UTF8Splitter;
//# sourceMappingURL=utfSplitter.js.map