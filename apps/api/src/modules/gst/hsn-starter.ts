/**
 * HSN/SAC starter list seeded into every new tenant (P1-08): codes a secondary-sector
 * manufacturer meets first — polymers and plastic articles, packaging, paper, metals,
 * chemicals, machinery and spares, and the services it buys. Rates are the schedule
 * rates in force in September 2026; tenants edit them and add their own codes.
 */
export interface HsnStarter {
  code: string;
  type: "HSN" | "SAC";
  description: string;
  gstRate: number;
  cessRate?: number;
}

export const HSN_STARTER: readonly HsnStarter[] = [
  // Polymers and plastics
  {
    code: "3901",
    type: "HSN",
    description: "Polymers of ethylene, in primary forms (LDPE, HDPE)",
    gstRate: 18,
  },
  {
    code: "3902",
    type: "HSN",
    description: "Polymers of propylene, in primary forms (PP)",
    gstRate: 18,
  },
  {
    code: "3904",
    type: "HSN",
    description: "Polymers of vinyl chloride (PVC), in primary forms",
    gstRate: 18,
  },
  {
    code: "3907",
    type: "HSN",
    description: "Polyethylene terephthalate (PET) and other polyesters",
    gstRate: 18,
  },
  { code: "3915", type: "HSN", description: "Waste, parings and scrap of plastics", gstRate: 18 },
  {
    code: "3917",
    type: "HSN",
    description: "Tubes, pipes, hoses and fittings of plastics",
    gstRate: 18,
  },
  {
    code: "3920",
    type: "HSN",
    description: "Plates, sheets, film, foil and strip of plastics",
    gstRate: 18,
  },
  {
    code: "3923",
    type: "HSN",
    description: "Articles for conveyance or packing of goods, of plastics; stoppers, lids, caps",
    gstRate: 18,
  },
  {
    code: "3924",
    type: "HSN",
    description: "Tableware, kitchenware and household articles of plastics",
    gstRate: 18,
  },
  { code: "3926", type: "HSN", description: "Other articles of plastics", gstRate: 18 },
  // Rubber
  { code: "4016", type: "HSN", description: "Other articles of vulcanised rubber", gstRate: 18 },
  // Paper and packaging
  { code: "4804", type: "HSN", description: "Uncoated kraft paper and paperboard", gstRate: 12 },
  { code: "4808", type: "HSN", description: "Corrugated paper and paperboard", gstRate: 12 },
  {
    code: "4819",
    type: "HSN",
    description: "Cartons, boxes, cases, bags and other packing containers of paper",
    gstRate: 18,
  },
  { code: "4821", type: "HSN", description: "Paper or paperboard labels", gstRate: 18 },
  // Textiles used in packaging
  {
    code: "6305",
    type: "HSN",
    description: "Sacks and bags for packing of goods (woven, PP/HDPE)",
    gstRate: 5,
  },
  // Glass
  { code: "7010", type: "HSN", description: "Bottles, jars and containers of glass", gstRate: 18 },
  // Iron and steel
  {
    code: "7208",
    type: "HSN",
    description: "Flat-rolled products of iron or non-alloy steel, hot-rolled",
    gstRate: 18,
  },
  {
    code: "7214",
    type: "HSN",
    description: "Bars and rods of iron or non-alloy steel",
    gstRate: 18,
  },
  {
    code: "7216",
    type: "HSN",
    description: "Angles, shapes and sections of iron or non-alloy steel",
    gstRate: 18,
  },
  {
    code: "7304",
    type: "HSN",
    description: "Tubes, pipes and hollow profiles of iron or steel",
    gstRate: 18,
  },
  {
    code: "7318",
    type: "HSN",
    description: "Screws, bolts, nuts, washers and similar of iron or steel",
    gstRate: 18,
  },
  { code: "7326", type: "HSN", description: "Other articles of iron or steel", gstRate: 18 },
  // Aluminium and copper
  { code: "7604", type: "HSN", description: "Aluminium bars, rods and profiles", gstRate: 18 },
  { code: "7607", type: "HSN", description: "Aluminium foil", gstRate: 18 },
  { code: "7408", type: "HSN", description: "Copper wire", gstRate: 18 },
  // Chemicals, inks, adhesives
  {
    code: "3208",
    type: "HSN",
    description: "Paints and varnishes based on synthetic polymers",
    gstRate: 18,
  },
  { code: "3215", type: "HSN", description: "Printing ink", gstRate: 18 },
  { code: "3506", type: "HSN", description: "Prepared glues and adhesives", gstRate: 18 },
  {
    code: "3812",
    type: "HSN",
    description: "Prepared rubber accelerators; plasticisers; anti-oxidants",
    gstRate: 18,
  },
  {
    code: "3204",
    type: "HSN",
    description: "Synthetic organic colouring matter; masterbatch pigments",
    gstRate: 18,
  },
  // Machinery and spares
  {
    code: "8477",
    type: "HSN",
    description: "Machinery for working rubber or plastics (injection, blow, extrusion)",
    gstRate: 18,
  },
  {
    code: "8480",
    type: "HSN",
    description: "Moulds for rubber or plastics; moulding boxes",
    gstRate: 18,
  },
  {
    code: "8422",
    type: "HSN",
    description: "Packing, wrapping, filling and labelling machinery",
    gstRate: 18,
  },
  {
    code: "8483",
    type: "HSN",
    description: "Transmission shafts, bearings housings, gears",
    gstRate: 18,
  },
  { code: "8501", type: "HSN", description: "Electric motors and generators", gstRate: 18 },
  {
    code: "8536",
    type: "HSN",
    description: "Electrical switches, relays, connectors",
    gstRate: 18,
  },
  { code: "8414", type: "HSN", description: "Air or vacuum pumps, compressors, fans", gstRate: 18 },
  { code: "8418", type: "HSN", description: "Refrigerating equipment, chillers", gstRate: 18 },
  { code: "8471", type: "HSN", description: "Computers and peripherals", gstRate: 18 },
  { code: "9403", type: "HSN", description: "Other furniture and parts", gstRate: 18 },
  // Fuel and utilities
  { code: "2710", type: "HSN", description: "Petroleum oils, lubricants (non-fuel)", gstRate: 18 },
  { code: "2711", type: "HSN", description: "Petroleum gases (LPG, industrial)", gstRate: 18 },
  // Services (SAC)
  { code: "9954", type: "SAC", description: "Construction services", gstRate: 18 },
  { code: "9965", type: "SAC", description: "Goods transport services (GTA)", gstRate: 5 },
  {
    code: "9967",
    type: "SAC",
    description: "Supporting services in transport; warehousing",
    gstRate: 18,
  },
  {
    code: "9971",
    type: "SAC",
    description: "Financial and related services (bank charges)",
    gstRate: 18,
  },
  { code: "9972", type: "SAC", description: "Real estate services; commercial rent", gstRate: 18 },
  {
    code: "9973",
    type: "SAC",
    description: "Leasing or rental services with or without operator",
    gstRate: 18,
  },
  { code: "9982", type: "SAC", description: "Legal and accounting services", gstRate: 18 },
  {
    code: "9983",
    type: "SAC",
    description: "Other professional, technical and business services",
    gstRate: 18,
  },
  {
    code: "9984",
    type: "SAC",
    description: "Telecommunications, broadcasting and information supply",
    gstRate: 18,
  },
  {
    code: "9985",
    type: "SAC",
    description: "Support services (manpower, security, housekeeping)",
    gstRate: 18,
  },
  {
    code: "9987",
    type: "SAC",
    description: "Maintenance, repair and installation services",
    gstRate: 18,
  },
  {
    code: "9988",
    type: "SAC",
    description: "Manufacturing services on physical inputs owned by others (job work)",
    gstRate: 12,
  },
  { code: "9997", type: "SAC", description: "Other services", gstRate: 18 },
];

/** Statutory GST slabs; cess variants are added by tenants that need them. */
export const GST_SLABS: readonly { name: string; rate: number }[] = [
  { name: "Exempt / Nil", rate: 0 },
  { name: "GST 0.25%", rate: 0.25 },
  { name: "GST 3%", rate: 3 },
  { name: "GST 5%", rate: 5 },
  { name: "GST 12%", rate: 12 },
  { name: "GST 18%", rate: 18 },
  { name: "GST 28%", rate: 28 },
];
