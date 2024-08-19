export type ColumnType = [title: string, width: number, align: "l" | "r"];

export class ColumnPrinter {
    constructor(
        public columns: ColumnType[],
        public separator: string = "  "
    ) {
        for (const ct of this.columns) {
            ct[1] = Math.max(ct[1], ct[0].length);
        }
    }

    line(...items: string[]) {
        const chunks = this.columns.map(([_, width, align], ind) => (align === "l" ? items[ind].padEnd(width) : items[ind].padStart(width)));
        return chunks.join(this.separator);
    }

    printHeader() {
        this.printLine(...this.columns.map((it) => it[0]));
    }

    printLine(...items: string[]) {
        console.log(this.line(...items));
    }
}
