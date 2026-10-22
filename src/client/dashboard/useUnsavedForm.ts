import { useCallback, useState } from 'react';
import { useUnsavedDraft } from './useUnsavedDraft.ts';

function snapshot(form: HTMLFormElement) {
  return JSON.stringify([...form.elements].flatMap(control => {
    if (control instanceof HTMLInputElement) {
      if (['button', 'submit', 'reset', 'hidden'].includes(control.type)) return [];
      return [[control.name, control.type, control.type === 'checkbox' || control.type === 'radio' ? control.checked : control.value]];
    }
    if (control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) return [[control.name, control.value]];
    return [];
  }));
}

/** Capture real initial values, including controlled React fields and prefilled details. */
export function useUnsavedForm(busy = false) {
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const [baseline, setBaseline] = useState('');
  const [revision, setRevision] = useState('');
  const guard = useUnsavedDraft(revision !== baseline, busy, revision);
  const bindForm = useCallback((node: HTMLFormElement | null) => {
    if (node) node.dataset.unsavedGuard = 'true';
    setForm(node);
    const value = node ? snapshot(node) : '';
    setBaseline(value);
    setRevision(value);
  }, []);
  return {
    bindForm,
    // Run in the bubbling phase, after controlled field handlers. Native input
    // also detects the same text typed again after form.reset().
    trackChanges: () => { if (form) setRevision(snapshot(form)); },
    confirmLeave: guard.confirmLeave,
    markSaved: () => {
      if (form) {
        const value = snapshot(form);
        guard.markSaved(value);
        setBaseline(value);
        setRevision(value);
      }
    },
  };
}
