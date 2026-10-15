export function activeCardForm(root) {
  return root.querySelector("form.f3-form:not(.non-editable)");
}

export function hasCardDraft(root) {
  const form = activeCardForm(root);
  if (!form) return false;
  return [...form.elements].some(field => {
    if (field.disabled || !field.name || ["submit", "button", "reset", "hidden"].includes(field.type)) return false;
    if (["radio", "checkbox"].includes(field.type)) return field.checked !== field.defaultChecked;
    if (field.tagName === "SELECT") {
      const original = [...field.options].find(option => option.defaultSelected) ?? field.options[0];
      return field.value !== (original?.value ?? "");
    }
    return field.value !== field.defaultValue;
  });
}

// The chart applies form changes synchronously. Submit before exporting its
// store so page Save and Download draft include the fields still being typed.
export function applyCardDraft(root, editor) {
  if (!hasCardDraft(root)) return true;
  const form = activeCardForm(root);
  if (!editor || !form.reportValidity()) return false;
  form.requestSubmit();
  return !hasCardDraft(root);
}
