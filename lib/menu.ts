import { fromStroops, toStroops } from "@/lib/amount";

export const MENU = [
  {
    id: "iced-tea",
    name: "Iced calamansi tea",
    description: "A cool citrus break between classes.",
    price: "1.5",
    icon: "tea",
    tag: "Cool down",
  },
  {
    id: "cheese-bread",
    name: "Warm cheese bread",
    description: "Soft, cheesy, and fresh from the oven.",
    price: "2",
    icon: "bread",
    tag: "Campus favourite",
  },
  {
    id: "snack-combo",
    name: "The study-break combo",
    description: "Cheese bread + iced tea. Better together.",
    price: "3.5",
    icon: "combo",
    tag: "Best of both",
  },
] as const;

export type MenuItem = (typeof MENU)[number];
export type MenuItemId = MenuItem["id"];

export function menuItem(id: unknown): MenuItem {
  const item = MENU.find((candidate) => candidate.id === id);
  if (!item) throw new Error("Choose a snack from the menu.");
  return item;
}

// Match the percentage Split: 9,000 bps vendor, 1,000 bps student org.
// The last recipient receives the integer rounding remainder.
export function priceBreakdown(item: { price: string }) {
  const amount = toStroops(item.price);
  const vendor = (BigInt(amount) * 9000n) / 10000n;
  return {
    amount,
    vendor: fromStroops(vendor.toString()),
    studentOrg: fromStroops((BigInt(amount) - vendor).toString()),
  };
}
