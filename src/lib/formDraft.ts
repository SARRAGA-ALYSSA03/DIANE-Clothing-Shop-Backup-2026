/**
 * Small, device-local draft helpers for ordinary form fields.
 * Passwords, file inputs, hidden controls, and disabled fields are never saved.
 * These drafts are not submitted to Supabase; the existing Save/Submit handlers
 * remain the only way to write permanent records.
 */
export type DraftValue = string | boolean;
export type DraftFields = Record<string, DraftValue>;

interface DraftEnvelope {
  version: 1;
  savedAt: string;
  fields: DraftFields;
}

function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readDraftFields(key: string | null): DraftFields | null {
  if (!key) return null;
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftEnvelope>;
    if (parsed.version !== 1 || !parsed.fields || typeof parsed.fields !== "object") {
      return null;
    }
    return parsed.fields as DraftFields;
  } catch {
    return null;
  }
}

export function writeDraftFields(key: string | null, fields: DraftFields): boolean {
  if (!key) return false;
  const storage = getStorage();
  if (!storage) return false;

  try {
    const envelope: DraftEnvelope = {
      version: 1,
      savedAt: new Date().toISOString(),
      fields,
    };
    storage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function clearFormDraft(key: string | null): void {
  if (!key) return;
  const storage = getStorage();
  try {
    storage?.removeItem(key);
  } catch {
    // Draft cleanup must never block a successful form submission.
  }
}

export function restoreFormDraft(key: string | null, form: HTMLFormElement): boolean {
  const fields = readDraftFields(key);
  if (!fields) return false;

  const controls = Array.from(form.elements).filter(
    (element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement,
  );

  for (const [name, value] of Object.entries(fields)) {
    const matching = controls.filter((control) => control.name === name && !control.disabled);
    if (matching.length === 0) continue;

    if (matching[0] instanceof HTMLInputElement && matching[0].type === "radio") {
      for (const control of matching) {
        if (control instanceof HTMLInputElement && control.type === "radio") {
          control.checked = control.value === String(value);
        }
      }
    } else if (matching[0] instanceof HTMLInputElement && matching[0].type === "checkbox") {
      (matching[0] as HTMLInputElement).checked = Boolean(value);
    } else {
      matching[0].value = String(value);
    }
  }

  return true;
}

export function saveFormDraft(key: string | null, form: HTMLFormElement): boolean {
  const fields: DraftFields = {};
  const controls = Array.from(form.elements).filter(
    (element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement,
  );

  for (const control of controls) {
    if (!control.name || control.disabled) continue;

    if (control instanceof HTMLInputElement) {
      const type = control.type.toLowerCase();
      if (["password", "file", "hidden", "submit", "button", "reset"].includes(type)) {
        continue;
      }
      if (type === "radio") {
        if (control.checked) fields[control.name] = control.value;
        continue;
      }
      if (type === "checkbox") {
        fields[control.name] = control.checked;
        continue;
      }
    }

    fields[control.name] = control.value;
  }

  return writeDraftFields(key, fields);
}
