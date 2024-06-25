

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

    static fromList(list) {
        const buffers = list.map(e => e.uint8Array)
        const newSize = buffers.map(e => e.length).reduce((acc, cur) => acc+cur, 0) + 4 * buffers.length
        const out = new Uint8Array(newSize)
        const view = new DataView(out.buffer);
        var pos = 0
        buffers.forEach(buf => {
            view.setInt32(pos, buf.length, false)
            out.set(buf, pos + 4)
            pos += 4 + buf.length
            console.log("fromList loop", buf, pos, out)
        });
        return new ACEBuffer(out)
    }

    toList() {
        var pos = 0
        var out = []
        const view = new DataView(this.uint8Array.buffer)
        while (pos < this.uint8Array.length) {
            const len = view.getInt32(pos, false)
            out.push(new ACEBuffer(
                this.uint8Array.slice(pos+4, pos+4+len))
            )
            pos += 4 + len
        }
        return out
    }
}

