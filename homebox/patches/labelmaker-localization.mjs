import fs from "node:fs";
import path from "node:path";

const root = "/usr/src/homebox";

function replaceExactly(file, before, after, description) {
  const fullPath = path.join(root, file);
  const source = fs.readFileSync(fullPath, "utf8");
  const count = source.split(before).length - 1;

  if (count !== 1) {
    throw new Error(
      `Label-maker localization patch expected exactly one occurrence of "${description}" in ${file}, found ${count}`
    );
  }

  fs.writeFileSync(fullPath, source.replace(before, after), "utf8");
}

// The backend renders label PNGs and has no access to the frontend locale.
// Pass the selected-language text from the UI as query parameters instead.
replaceExactly(
  "backend/app/api/handlers/v1/v1_ctrl_labelmaker.go",
  "func generateOrPrint(ctrl *V1Controller, w http.ResponseWriter, r *http.Request, title string, description string, url string) error {",
  `// labelText returns a caller-supplied translation for fixed text printed on a label.
 // The frontend passes the user's selected language; direct API callers retain English fallbacks.
 func labelText(r *http.Request, param string, fallback string) string {
  if value := strings.TrimSpace(r.URL.Query().Get(param)); value != "" {
   return value
  }
  return fallback
 }

 func generateOrPrint(ctrl *V1Controller, w http.ResponseWriter, r *http.Request, title string, description string, url string) error {`,
  "labelText helper insertion"
);

replaceExactly(
  "backend/app/api/handlers/v1/v1_ctrl_labelmaker.go",
  'return generateOrPrint(ctrl, w, r, location.Name, "Homebox Location", fmt.Sprintf("%s/location/%s", hbURL, location.ID))',
  'description := labelText(r, "locationDescription", "Homebox Location")\n\t\treturn generateOrPrint(ctrl, w, r, location.Name, description, fmt.Sprintf("%s/location/%s", hbURL, location.ID))',
  "location label description"
);

replaceExactly(
  "backend/app/api/handlers/v1/v1_ctrl_labelmaker.go",
  'description += fmt.Sprintf("\\nLocation: %s", item.Parent.Name)',
  'description += fmt.Sprintf("\\n%s: %s", labelText(r, "locationLabel", "Location"), item.Parent.Name)',
  "item location prefix"
);

replaceExactly(
  "backend/app/api/handlers/v1/v1_ctrl_labelmaker.go",
  'description += fmt.Sprintf("\\nLocation: %s", item.Items[0].Parent.Name)',
  'description += fmt.Sprintf("\\n%s: %s", labelText(r, "locationLabel", "Location"), item.Items[0].Parent.Name)',
  "asset location prefix"
);

// Document the new optional query parameters for the API.
replaceExactly(
  "backend/app/api/handlers/v1/v1_ctrl_labelmaker.go",
  '//\t@Param\t\tprint\tquery\t\tbool\tfalse\t"Print this label, defaults to false"\n//\t@Success\t200',
  '//\t@Param\t\tprint\t\t\tquery\t\tbool\tfalse\t"Print this label, defaults to false"\n//\t@Param\t\tlocationDescription\tquery\t\tstring\tfalse\t"Translated text, defaults to Homebox Location"\n//\t@Success\t200',
  "location label swagger parameter"
);

// The item and asset handlers each have the same print parameter line.
const goPath = path.join(root, "backend/app/api/handlers/v1/v1_ctrl_labelmaker.go");
let goSource = fs.readFileSync(goPath, "utf8");
const printParam = '//\t@Param\t\tprint\tquery\t\tbool\tfalse\t"Print this label, defaults to false"';
const translatedParam = printParam + '\n//\t@Param\t\tlocationLabel\tquery\t\tstring\tfalse\t"Translated location label, defaults to Location"';
const printCount = goSource.split(printParam).length - 1;
if (printCount !== 3) {
  throw new Error(`Expected 3 label-maker print parameter annotations, found ${printCount}`);
}
// Location handler was already updated above; add locationLabel only to item and asset routes.
goSource = goSource.replace(
  '//\t@Param\t\tid\t\tpath\t\tstring\ttrue\t"Item ID"\n' + printParam,
  '//\t@Param\t\t id\tpath\t\tstring\ttrue\t"Item ID"\n' + translatedParam
);
goSource = goSource.replace(
  '//\t@Param\t\tid\t\t\t\tpath\t\tstring\ttrue\t"Asset ID"\n' + printParam,
  '//\t@Param\t\tid\t\t\t\tpath\t\tstring\ttrue\t"Asset ID"\n' + translatedParam
);
fs.writeFileSync(goPath, goSource, "utf8");

// Pass translations from the currently selected UI language.
replaceExactly(
  "frontend/components/global/LabelMaker.vue",
  `    if (props.type === "item" || props.type === "entity") {
      return route(` + "`/labelmaker/entity/${props.id}`, params);" + `
    } else if (props.type === "location") {
      return route(` + "`/labelmaker/location/${props.id}`, params);" + `
    } else if (props.type === "asset") {
      return route(` + "`/labelmaker/asset/${props.id}`, params);" + `
    } else {`,
  `    // The backend has no translations of its own, so pass the user's selected language.
    if (props.type === "item" || props.type === "entity") {
      params.locationLabel = t("components.global.label_maker.location_label");
      return route(` + "`/labelmaker/entity/${props.id}`, params);" + `
    } else if (props.type === "location") {
      params.locationDescription = t("components.global.label_maker.location_description");
      return route(` + "`/labelmaker/location/${props.id}`, params);" + `
    } else if (props.type === "asset") {
      params.locationLabel = t("components.global.label_maker.location_label");
      return route(` + "`/labelmaker/asset/${props.id}`, params);" + `
    } else {`,
  "frontend label URL generation"
);

// Keep label-specific wording separate from the general UI term "Lokalizacja".
for (const [file, values] of [
  ["frontend/locales/en.json", { location_label: "Location", location_description: "Homebox Location" }],
  ["frontend/locales/pl.json", { location_label: "Miejsce", location_description: "Miejsce" }],
]) {
  const fullPath = path.join(root, file);
  const locale = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  locale.components ??= {};
  locale.components.global ??= {};
  locale.components.global.label_maker ??= {};
  Object.assign(locale.components.global.label_maker, values);
  fs.writeFileSync(fullPath, JSON.stringify(locale, null, 4) + "\n", "utf8");
}

// Regression tests for translated text and English fallback behavior.
const testPath = path.join(root, "backend/app/api/handlers/v1/v1_ctrl_labelmaker_test.go");
fs.writeFileSync(
  testPath,
  `package v1

import (
 "net/http/httptest"
 "testing"

 "github.com/stretchr/testify/assert"
)

func TestLabelText(t *testing.T) {
 cases := []struct {
  name string
  target string
  param string
  fallback string
  expected string
 }{
  {
   name: "missing parameter falls back to English",
   target: "/labelmaker/item/1",
   param: "locationLabel",
   fallback: "Location",
   expected: "Location",
  },
  {
   name: "translation is used when supplied",
   target: "/labelmaker/item/1?locationLabel=Miejsce",
   param: "locationLabel",
   fallback: "Location",
   expected: "Miejsce",
  },
  {
   name: "empty value falls back to English",
   target: "/labelmaker/item/1?locationLabel=",
   param: "locationLabel",
   fallback: "Location",
   expected: "Location",
  },
  {
   name: "surrounding whitespace is trimmed",
   target: "/labelmaker/item/1?locationLabel=%20Miejsce%20",
   param: "locationLabel",
   fallback: "Location",
   expected: "Miejsce",
  },
  {
   name: "location descriptor is independently translated",
   target: "/labelmaker/location/1?locationDescription=Miejsce",
   param: "locationDescription",
   fallback: "Homebox Location",
   expected: "Miejsce",
  },
 }

 for _, tc := range cases {
  t.Run(tc.name, func(t *testing.T) {
   request := httptest.NewRequest("GET", tc.target, nil)
   assert.Equal(t, tc.expected, labelText(request, tc.param, tc.fallback))
  })
 }
}
`,
  "utf8"
);
