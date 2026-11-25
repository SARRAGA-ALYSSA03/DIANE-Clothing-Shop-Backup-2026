import { AlertCircle, LoaderCircle } from "lucide-react";

export function LoadingState({ label = "Loading your DIANE experience" }: { label?: string }) {
  return (
    <div className="state-view">
      <LoaderCircle className="spin" size={22} />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state-view state-view--error">
      <AlertCircle size={22} />
      <div>
        <strong>Unable to load live store data</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <span>DIANE</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
