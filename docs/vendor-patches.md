# Family Chart local patches

The vendored Family Chart 0.9.0 bundle remains the layout and editor engine.
`assets/vendor/family-chart.js` has a small local security patch:

- Escape initial form values, form labels, relation labels, and card identifiers before HTML insertion.
- Escape person-search labels before adding the search highlight markup.

The personal viewer uses its own escaped card renderer and restricts avatar URL
schemes. These protections also cover names containing quotes and angle brackets;
the saved data keeps the original text.

When replacing the vendor bundle, preserve these patches or verify that upstream
uses safe DOM insertion in all these locations. Test a fictional name containing
quotes and HTML through both viewing and editing before releasing an update.

## Prikaz najbliže obitelji

Preglednik koristi postojeće `setAncestryDepth(1)`, `setProgenyDepth(1)` i
`setShowSiblingsOfMain(true)`. Samo ograničavanje dubine ostavlja vidljivima
partnere djece. Zato postojeći `setModifyTreeHierarchy` označava dječje D3 čvorove
s `_ignore_spouses`, što postojeći raspored već podržava. Oznaka pripada čvoru
rasporeda, a ne obiteljskom zapisu. Ovdje nije mijenjan kod biblioteke.

Pri zamjeni biblioteke treba provjeriti taj prikaz i spremanje cjelovitog skupa
podataka. Scenariji `nearest family` u testovima preglednika koriste izmišljenu
obitelj s polubraćom/polusestrama, više partnera, drugim roditeljem bez partnerske
veze i udaljenim granama. Provjeravaju točan skup kartica te očuvanje svih zapisa
u kanonskoj i šifriranoj datoteci nakon spremanja iz ograničenog prikaza.
