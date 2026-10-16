# Repair: where a zone boundary requires a wet-room lining that its surface's recipe does not provide on that
# side, apply the wet-room membrane system as a covering on that boundary — only the part of the surface the
# wet room faces, not the whole recipe.
PREFIX twb: <https://w3id.org/twb#>
INSERT { ?boundary twb:hasCovering <https://example.org/twb/case-house/covering-wet-room-system> . }
WHERE {
  ?boundary twb:requires twb:WetRoomLining ; twb:onSide ?side .
  ?surface twb:positiveSide|twb:negativeSide ?side ; twb:hasRecipe ?recipe .
  FILTER NOT EXISTS { ?recipe twb:provides twb:WetRoomLining }
  FILTER NOT EXISTS { ?side twb:isInside true . ?recipe twb:providesInside twb:WetRoomLining }
  FILTER NOT EXISTS { ?side twb:isInside false . ?recipe twb:providesOutside twb:WetRoomLining }
}
