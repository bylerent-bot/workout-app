# LOADOUT RECEIPT object art system

The object comparison is a flagship score reveal, not trivia under the workout summary.

## Art direction

- Canvas: 64 by 64 logical pixels, `viewBox="0 0 64 64"`.
- Grid: 4px base blocks with occasional 2px detail.
- Rendering: `shape-rendering="crispEdges"`; no curves unless converted to stepped blocks.
- Outline: 4px near-black on the silhouette edge.
- Light: upper left, with one bright highlight and one deep shadow plane.
- Palette: maximum six colors per object, drawn from the core system plus object-specific steel or body color.
- Grounding: every object sits on an 8px shadow strip so mixed sprites align in a receipt row.
- Personality: aggressive stance, dents, tape, sparks, heavy machinery. No faces, blush, smiles, or kawaii proportions.
- Labels always carry both the object and exact comparison: `4,800 LB = 1 FULL-SIZE PICKUP`.
- Use recognizable categories, not protected logos or celebrity likenesses. A future celebrity comparison should use licensed editorial art or a name-only comparison.

## Weight ladder

| Asset | Reference weight | Share label |
|---|---:|---|
| `safe-500.svg` | 500 lb | CAST-IRON SAFE |
| `piano-700.svg` | 700 lb | CONCERT PIANO |
| `vending-900.svg` | 900 lb | LOADED VENDING MACHINE |
| `gold-1000.svg` | 1,000 lb | 36 GOLD BARS |
| `motorcycle-1200.svg` | 1,200 lb | FULL-DRESS TOURING BIKE |
| `dragster-1800.svg` | 1,800 lb | DRAGSTER |
| `sedan-3200.svg` | 3,200 lb | SPORT SEDAN |
| `pickup-4800.svg` | 4,800 lb | FULL-SIZE PICKUP |
| `armored-suv-6500.svg` | 6,500 lb | ARMORED SUV |
| `container-8500.svg` | 8,500 lb | EMPTY 20-FT CONTAINER |
| `monster-truck-12000.svg` | 12,000 lb | MONSTER TRUCK |
| `city-bus-28000.svg` | 28,000 lb | CITY BUS |

Reference weights are intentionally round game values, not claims about every model. Engineering should store comparisons as editorial entries with a label, reference weight, and source note when a specific real-world make or person is introduced.

## Selection logic

Pick the largest object for which the workout volume is at least 0.85 times the object weight. Show a count only between 2 and 9. Above 9, promote to the next object or show a mixed loadout using greedy decomposition. Avoid absurd decimals. `1.1 PICKUPS` becomes `1 PICKUP + 1 SAFE`.

The share card uses at most three objects. The largest object owns 65 percent of the art area.
