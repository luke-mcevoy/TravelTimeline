import { inferTripsFromPhotos } from './src/services/applePhotos.ts';
const trips = await inferTripsFromPhotos(3);
const sorted = trips.flatMap(t=>t.destinations);
const cityCount={};
for (const d of sorted) cityCount[d.city]=(cityCount[d.city]||0)+1;
const dupes = Object.entries(cityCount).filter(([,n])=>n>1);
console.log("trips:", trips.length, "destinations:", sorted.length);
console.log("cities appearing >1 time:", dupes.length ? dupes.map(([c,n])=>`${c}:${n}`).join(", ") : "NONE");
