

export class ACEBuffer {
    constructor(uint8Array) {
        this.uint8Array = uint8Array;
    }
    
    static fromString(str) {
        const encoder = new TextEncoder();
        return new ACEBuffer(encoder.encode(str));
    }

    toString() {
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(this.uint8Array);
    }

    static fromInt32(int) {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        view.setInt32(0, int, false); // true for little-endian
        return new Uint8Array(buffer);
    }

    toInt32() {
        const view = new DataView(this.uint8Array.buffer);
        return view.getInt32(0, false); // true for little-endian
    }
}
