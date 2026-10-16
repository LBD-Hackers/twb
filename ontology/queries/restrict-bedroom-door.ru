# An access restriction: the door between the living room and bedroom 1 can be opened from the
# living room only — a room locked from the hall side, as a store room is. Rule 41 is re-run after it.
PREFIX twb: <https://w3id.org/twb#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
INSERT { ?p twb:openableFrom ?living . }
WHERE {
  ?p a twb:Passage ; twb:connectsZone ?bed, ?living .
  ?bed rdfs:label "Bedroom 1"@en .
  ?living rdfs:label "Living and kitchen"@en .
}
