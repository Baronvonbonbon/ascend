import type { ItemType, Buc } from "./items";

export interface Item { type: ItemType; charges?: number; enchant?: number; relic?: boolean; buc?: Buc; bucKnown?: boolean; erosion?: number; erosionKind?: "rust" | "burn"; proofed?: boolean; contents?: Item[]; label?: string; lit?: boolean; fuel?: number; unpaid?: number; } // unpaid = gold owed for a shop ware carried on your bill (settled at the door) // charges for wands; enchant/relic for artifacts; buc = sanctity; erosion 0–3 severity; erosionKind = rust/corrosion vs fire-burn; proofed = erosion-proofed; contents = a bag's stash; label = player-given #name; fuel = a lit lamp's remaining oil

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
