// Extension points other modules plug into without import cycles. This file
// imports nothing, so anything can depend on it safely.
//   intercept(e, lineups) -> true  swallow a landing-marker click (multi-select)
//   badge(el, cluster)             decorate a freshly built landing marker
//   afterRender()                  runs at the end of every renderMarkers()
//   onMapChange()                  a different map was selected
//   afterLoad()                    the map's lineups finished loading
export const hooks = { intercept: null, badge: null, afterRender: null, onMapChange: null, afterLoad: null };
