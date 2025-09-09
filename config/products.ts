export type ProductDef = {
  key: "intro" | "full" | "family" | "magnet_pack" | "donation";
  name: string;
  description: string;
  defaultPriceUsd: number; // 0 for donation (variable)
  interval?: "one_time";
};

export const DEFAULT_PRODUCTS: ProductDef[] = [
  { key: "intro",  name: "Blueprint Intro", description: "Personalized intro blueprint, digestible and actionable.", defaultPriceUsd: 39, interval: "one_time" },
  { key: "full",   name: "Blueprint Full",  description: "Deep soul blueprint + magnet schedule pack.", defaultPriceUsd: 129, interval: "one_time" },
  { key: "family", name: "Family Bundle",   description: "Adult + child blueprint bundle.", defaultPriceUsd: 189, interval: "one_time" },
  { key: "magnet_pack", name: "Custom Magnet Pack", description: "Add-on: custom magnets mapped to your rhythm.", defaultPriceUsd: 29, interval: "one_time" },
  { key: "donation", name: "Donation", description: "Support the non-profit mission.", defaultPriceUsd: 0 }
];
