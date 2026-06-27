import type { ItemType, Buc } from "./items";

export interface Item { type: ItemType; charges?: number; enchant?: number; relic?: boolean; buc?: Buc; bucKnown?: boolean; erosion?: number; proofed?: boolean; } // charges for wands; enchant/relic for NFT gear; buc = sanctity; erosion 0–3 = rust/corrosion; proofed = audited (rust-proof)

/** Letter-indexed pack (a, b, c, …). */
export class Inventory {
  items: Item[] = [];

  add(t: ItemType): Item {
    const it: Item = { type: t };
    this.items.push(it);
    return it;
  }

  remove(item: Item): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  letter(i: number): string {
    return String.fromCharCode(97 + i);
  }

  byLetter(ch: string): Item | undefined {
    return this.items[ch.charCodeAt(0) - 97];
  }

  get full(): boolean {
    return this.items.length >= 20; // a..t
  }
}
