/** Native form baselines complement the financial editors' navigation guards. */
export function hasEditedForm(document: Document) {
  return [...document.querySelectorAll('form input, form textarea, form select, input[type="file"]')].some(
    (control) => {
      if (control instanceof HTMLInputElement) {
        if (control.disabled || ['hidden', 'submit', 'button', 'reset'].includes(control.type)) return false;
        if (control.type === 'file') return Boolean(control.files?.length);
        if (control.type === 'checkbox' || control.type === 'radio')
          return control.checked !== control.defaultChecked;
        return control.value !== control.defaultValue;
      }
      if (control instanceof HTMLTextAreaElement)
        return !control.disabled && control.value !== control.defaultValue;
      if (control instanceof HTMLSelectElement) {
        if (control.disabled) return false;
        const defaults = [...control.options]
          .filter((option) => option.defaultSelected)
          .map((option) => option.value);
        const selected = [...control.selectedOptions].map((option) => option.value);
        // A select without an explicit baseline defaults to its first option.
        if (!defaults.length && !control.multiple && control.options[0])
          defaults.push(control.options[0].value);
        return defaults.join('\0') !== selected.join('\0');
      }
      return false;
    },
  );
}
