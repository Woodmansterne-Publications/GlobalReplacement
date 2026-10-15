# Global Replacement

Planners review replacement materials in the context of their current physical placement.

## Language

**Account**: An account code associated with one or more active displays.

**Rack**: A physical group of pockets belonging to one display, identified by its rack code. Neighbourhoods stay within that rack.

**Pocket**: A card location within a rack, identified by its tier and position. A material can occupy more than one pocket.

**Neighbourhood**: Up to three consecutive tiers and three consecutive positions around a selected target pocket. At rack boundaries it shifts inward; missing pocket coordinates remain gaps.

**Target material**: The current material being reviewed for replacement. All its visible pocket occurrences are targets; the selected pocket identifies which occurrence frames the neighbourhood.

**Shared tags**: Tags present on both the target material and a replacement candidate. They are shown as context and do not affect the candidate score.

**Pocket count**: The total number of physical pockets containing a material across the source displays, including repeated occurrences within one rack.
