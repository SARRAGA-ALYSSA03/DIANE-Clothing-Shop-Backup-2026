import { useState, type FormEvent } from "react";
import { Pencil, Plus, ShieldCheck, UserX } from "lucide-react";
import { manageRider } from "../../services/commerce";
import type { Profile } from "../../types/commerce";
import { EmptyState } from "../common/StateView";
import { clearFormDraft, readDraftFields, writeDraftFields } from "../../lib/formDraft";

type RiderDraft = { id?: string; name: string; email: string; phone: string; password: string };
const riderDraftKey = (id?: string) => `diane:admin:rider:${id || "new"}:draft`;
const riderEditorStateKey = "diane:admin:rider:editor-state";

function restoreRiderEditor(): RiderDraft | null {
  const editorState = readDraftFields(riderEditorStateKey);
  if (editorState?.open !== "true") return null;
  const id = String(editorState.id ?? "");
  const saved = readDraftFields(riderDraftKey(id || undefined));
  if (!saved) return null;
  return {
    ...(id ? { id } : {}),
    name: String(saved.name ?? ""),
    email: String(saved.email ?? ""),
    phone: String(saved.phone ?? ""),
    password: "",
  };
}

export function RiderManager({
  riders,
  onRefresh,
  search = "",
}: {
  riders: Profile[];
  onRefresh: () => Promise<void>;
  search?: string;
}) {
  const [draft, setDraft] = useState<RiderDraft | null>(restoreRiderEditor);
  const [busy, setBusy] = useState(false);
  const [busyRider, setBusyRider] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  const closeEditor = () => {
    clearFormDraft(riderEditorStateKey);
    setDraft(null);
  };

  const updateDraft = (changes: Partial<RiderDraft>) => {
    if (!draft) return;
    const next = { ...draft, ...changes };
    setDraft(next);
    writeDraftFields(riderDraftKey(next.id), {
      name: next.name,
      email: next.email,
      phone: next.phone,
    });
  };

  const filteredRiders = riders.filter((rider) =>
    `${rider.name} ${rider.email} ${rider.phone ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );

  const openCreate = () => {
    setMessage("");
    const saved = readDraftFields(riderDraftKey());
    setDraft({
      name: String(saved?.name ?? ""),
      email: String(saved?.email ?? ""),
      phone: String(saved?.phone ?? ""),
      password: "",
    });
    writeDraftFields(riderEditorStateKey, { open: "true", id: "" });
  };

  const openEdit = (rider: Profile) => {
    setMessage("");
    const saved = readDraftFields(riderDraftKey(rider.id));
    setDraft({
      id: rider.id,
      name: String(saved?.name ?? rider.name),
      email: String(saved?.email ?? rider.email),
      phone: String(saved?.phone ?? rider.phone ?? ""),
      password: "",
    });
    writeDraftFields(riderEditorStateKey, { open: "true", id: rider.id });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || busy) return;
    const name = draft.name.trim();
    const email = draft.email.trim().toLowerCase();
    const phone = draft.phone.trim();
    if (!name || name.length > 80 || !phone || phone.length > 30) {
      setMessage("Enter a rider name (80 characters maximum) and a valid contact number.");
      setMessageIsError(true);
      return;
    }
    if (!draft.id && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || draft.password.length < 8)) {
      setMessage("Enter a valid email and a temporary password with at least 8 characters.");
      setMessageIsError(true);
      return;
    }
    setBusy(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const result = await manageRider(
        draft.id
          ? { action: "update", rider_id: draft.id, name, phone }
          : { action: "create", name, email, phone, password: draft.password },
      );
      setMessage(result.message ?? (draft.id ? "Rider profile updated." : "Rider account created."));
      clearFormDraft(riderDraftKey(draft.id));
      clearFormDraft(riderEditorStateKey);
      setDraft(null);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save the rider account.");
      setMessageIsError(true);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (rider: Profile) => {
    const nextActive = rider.active === false;
    const actionLabel = nextActive ? "reactivate" : "deactivate";
    if (!window.confirm(`Are you sure you want to ${actionLabel} ${rider.name}'s rider account?`)) return;
    setBusyRider(rider.id);
    setMessage("");
    setMessageIsError(false);
    try {
      const result = await manageRider({ action: "set_active", rider_id: rider.id, active: nextActive });
      setMessage(result.message ?? `Rider account ${nextActive ? "activated" : "deactivated"}.`);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update the rider account.");
      setMessageIsError(true);
    } finally {
      setBusyRider(null);
    }
  };

  return (
    <section className="admin-data-section rider-manager">
      <div className="admin-section-actions">
        <div><span className="eyebrow">DIANE OPERATIONS</span><h2>Delivery riders</h2><p>{riders.length} registered rider accounts</p></div>
        <button className="button button--dark" onClick={openCreate}><Plus size={16} /> CREATE RIDER ACCOUNT</button>
      </div>
      {message && <div className={`form-message ${messageIsError ? "form-message--error" : ""}`} role="status">{message}</div>}
      {draft && (
        <section className="rider-editor">
          <header>
            <div><span className="eyebrow">RIDER ACCOUNT</span><h3>{draft.id ? "Edit rider profile" : "Create rider account"}</h3></div>
            <button type="button" className="icon-button" onClick={closeEditor} aria-label="Close rider form">×</button>
          </header>
          <form className="rider-editor__form" onSubmit={submit}>
            <label>Full name<input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} maxLength={80} required /></label>
            <label>Email address<input type="email" value={draft.email} disabled={Boolean(draft.id)} onChange={(event) => updateDraft({ email: event.target.value })} required /></label>
            <label>Contact number<input value={draft.phone} onChange={(event) => updateDraft({ phone: event.target.value })} maxLength={30} required /></label>
            {!draft.id && <label>Temporary password<input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} minLength={8} autoComplete="new-password" required /></label>}
            {!draft.id && <p className="field-help">The account is created in Supabase Auth and assigned the rider role. Share the temporary password securely. For security, it is not saved and must be entered again if the form is reopened.</p>}
            <p className="field-help">Rider name, email and contact number are saved automatically while this editor is open.</p>
            <div className="form-actions">
              <button className="button button--dark" disabled={busy}>{busy ? "SAVING…" : draft.id ? "SAVE RIDER DETAILS" : "CREATE RIDER"}</button>
              <button type="button" className="button button--outline" onClick={closeEditor}>CANCEL</button>
            </div>
          </form>
        </section>
      )}
      {filteredRiders.length === 0 ? (
        <EmptyState title="No rider accounts found" body={search ? "Try another search term." : "Create a rider account to begin assigning deliveries."} />
      ) : (
        <article className="admin-panel admin-table-panel">
          <div className="admin-table-wrap"><table>
            <thead><tr><th>Rider</th><th>Email</th><th>Phone</th><th>Status</th><th>Account actions</th></tr></thead>
            <tbody>{filteredRiders.map((rider) => {
              const active = rider.active !== false;
              return <tr key={rider.id}>
                <td><strong>{rider.name}</strong></td><td>{rider.email}</td><td>{rider.phone || "—"}</td>
                <td><strong className={`status ${active ? "status--delivered" : "status--cancelled"}`}>{active ? "Active" : "Inactive"}</strong></td>
                <td><div className="rider-row-actions">
                  <button onClick={() => openEdit(rider)}><Pencil size={13} /> Edit</button>
                  <button disabled={busyRider === rider.id} onClick={() => void toggleActive(rider)}>{active ? <UserX size={13} /> : <ShieldCheck size={13} />}{busyRider === rider.id ? "Updating…" : active ? "Deactivate" : "Activate"}</button>
                </div></td>
              </tr>;
            })}</tbody>
          </table></div>
        </article>
      )}
    </section>
  );
}
