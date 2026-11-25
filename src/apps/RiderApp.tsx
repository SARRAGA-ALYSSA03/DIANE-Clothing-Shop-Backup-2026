import { useEffect, useMemo, useState } from "react";
import {
  Bike,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Clock3,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Navigation,
  Phone,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { Brand } from "../components/common/Brand";
import { EmptyState, ErrorState, LoadingState } from "../components/common/StateView";
import { useAuth } from "../contexts/AuthContext";
import { peso, philippineDateTime } from "../lib/format";
import { supabase } from "../lib/supabase";
import { listRiderOrders, markDelivered } from "../services/commerce";
import type { Order } from "../types/commerce";

type RiderView = "dashboard" | "deliveries" | "history" | "profile";

export function RiderApp({
  onLogout,
}: {
  onLogout: () => Promise<void>;
}) {
  const { user, profile } = useAuth();
  const [view, setView] = useState<RiderView>(() => {
    try {
      const saved = localStorage.getItem(`diane-rider-view:${user?.id ?? "account"}`);
      if (["dashboard", "deliveries", "history", "profile"].includes(saved ?? "")) return saved as RiderView;
    } catch { /* Use the default page when storage is unavailable. */ }
    return "dashboard";
  });

  useEffect(() => {
    try {
      localStorage.setItem(`diane-rider-view:${user?.id ?? "account"}`, view);
    } catch { /* Page persistence is optional; rider operations remain available. */ }
  }, [view, user?.id]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cashCollected, setCashCollected] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const handleLogout = async () => {
    setAccountMenuOpen(false);
    try {
      await onLogout();
    } catch (error) {
      setNotice(error instanceof Error ? `Unable to sign out: ${error.message}` : "Unable to sign out. Please try again.");
    }
  };

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const result = await listRiderOrders(user.id);
    setOrders(result.data);
    setError(result.error?.message ?? "");
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`diane-rider-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `rider_id=eq.${user.id}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // The rider's own assignment is the subscription boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const active = useMemo(
    () => orders.filter((order) => order.status !== "Delivered" && order.status !== "Cancelled"),
    [orders],
  );
  const completed = useMemo(() => orders.filter((order) => order.status === "Delivered"), [orders]);

  const visible = view === "history" ? completed : active;

  return (
    <div className="rider-app">
      <header className="rider-header">
        <div className="rider-brand-button">
          <Brand light />
        </div>
        <div className="rider-account-actions">
          <span className="rider-role-label">RIDER</span>
          <div className={`admin-account-wrap ${accountMenuOpen ? "is-open" : ""}`}>
            <button
              className="admin-account rider-account-button"
              type="button"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              {profile?.name || "Rider"} <ChevronDown size={14} />
            </button>
            {accountMenuOpen && (
              <>
                <button
                  className="admin-account-dismiss"
                  aria-label="Close account menu"
                  onClick={() => setAccountMenuOpen(false)}
                />
                <div className="admin-account-menu" role="menu">
                  <div className="admin-account-menu__identity">
                    <strong>{profile?.name || "Rider account"}</strong>
                    <span>DIANE delivery partner</span>
                  </div>
                  <button type="button" role="menuitem" onClick={handleLogout}>
                    <LogOut size={16} /> Log Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="rider-main">
        {view === "dashboard" && (
          <>
            <section className="rider-welcome">
              <div>
                <span className="eyebrow">GOOD DAY</span>
                <h1>{profile?.name?.split(" ")[0] || "Rider"}</h1>
                <p>Here is your delivery route for today.</p>
              </div>
              <div className="rider-avatar">{profile?.name?.slice(0, 1) || "R"}</div>
            </section>
            <section className="rider-stats">
              <article>
                <span>
                  <Truck size={18} /> ACTIVE
                </span>
                <strong>{active.length}</strong>
                <p>assigned deliveries</p>
              </article>
              <article>
                <span>
                  <CheckCircle2 size={18} /> COMPLETED
                </span>
                <strong>{completed.length}</strong>
                <p>successful deliveries</p>
              </article>
            </section>
            <div className="rider-section-title">
              <div>
                <span className="eyebrow">TODAY'S ROUTE</span>
                <h2>Assigned deliveries</h2>
              </div>
              <button onClick={() => setView("deliveries")}>
                View all <ChevronRight size={15} />
              </button>
            </div>
          </>
        )}

        {view === "deliveries" && (
          <section className="rider-page-title">
            <span className="eyebrow">YOUR ROUTE</span>
            <h1>My deliveries</h1>
            <p>Only orders assigned to your rider account are shown.</p>
          </section>
        )}

        {view === "history" && (
          <section className="rider-page-title">
            <span className="eyebrow">COMPLETED WORK</span>
            <h1>Delivery history</h1>
            <p>Your successfully completed DIANE deliveries.</p>
          </section>
        )}

        {(view === "dashboard" || view === "deliveries" || view === "history") && (
          <section className="delivery-list">
            {loading && <LoadingState label="Loading assigned deliveries" />}
            {error && <ErrorState message={error} />}
            {!loading && !error && visible.length === 0 && (
              <EmptyState
                title={view === "history" ? "No completed deliveries yet" : "Your route is clear"}
                body="New assignments from the DIANE admin team will appear here."
              />
            )}
            {!loading &&
              !error &&
              visible.slice(0, view === "dashboard" ? 3 : undefined).map((order, index) => (
                <article
                  key={order.id}
                  onClick={() => {
                    setSelected(order);
                    setCashCollected(false);
                  }}
                >
                  <div className="delivery-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="delivery-content">
                    <div>
                      <span>ORDER {order.id.slice(0, 8).toUpperCase()}</span>
                      <strong
                        className={`status status--${order.status.toLowerCase().replace(/ /g, "-")}`}
                      >
                        {order.status}
                      </strong>
                    </div>
                    <h3>{order.full_name}</h3>
                    <p>
                      <MapPin size={14} /> {order.address}, {order.city}
                    </p>
                    <footer>
                      <span>
                        {order.payment_method} · {order.payment_status}
                      </span>
                      <strong>{peso.format(order.total)}</strong>
                    </footer>
                  </div>
                  <ChevronRight size={19} />
                </article>
              ))}
          </section>
        )}

        {view === "profile" && (
          <section className="rider-profile">
            <div className="rider-profile__monogram">{profile?.name?.slice(0, 1) || "R"}</div>
            <span className="eyebrow">DIANE DELIVERY PARTNER</span>
            <h1>{profile?.name}</h1>
            <p>{profile?.email}</p>
            <div>
              <span>Role</span>
              <strong>Rider</strong>
              <span>Account</span>
              <strong>{profile?.active === false ? "Inactive" : "Active"}</strong>
              <span>Completed</span>
              <strong>{completed.length} deliveries</strong>
            </div>
          </section>
        )}
      </main>

      <nav className="rider-bottom-nav">
        {[
          ["dashboard", LayoutDashboard, "Dashboard"],
          ["deliveries", Bike, "Deliveries"],
          ["history", History, "History"],
          ["profile", UserRound, "Profile"],
        ].map(([key, Icon, label]) => (
          <button
            key={String(key)}
            className={view === key ? "active" : ""}
            onClick={() => setView(key as RiderView)}
          >
            <Icon size={20} />
            <span>{String(label)}</span>
          </button>
        ))}
      </nav>

      {selected && (
        <div className="delivery-sheet-backdrop" onClick={() => setSelected(null)}>
          <article className="delivery-sheet" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="eyebrow">DELIVERY DETAILS</span>
                <h2>{selected.full_name}</h2>
              </div>
              <button className="icon-button" onClick={() => setSelected(null)}>
                <X />
              </button>
            </header>
            <div className="delivery-sheet__status">
              <Clock3 size={18} />
              <div>
                <span>CURRENT STATUS</span>
                <strong>{selected.status}</strong>
              </div>
            </div>
            <dl>
              <div>
                <dt>Order</dt>
                <dd>{selected.id}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>
                  {selected.address}, {selected.city} {selected.zip}
                </dd>
              </div>
              <div>
                <dt>Landmark</dt>
                <dd>{selected.landmark || "None provided"}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>{selected.phone}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>
                  {selected.payment_method} · {selected.payment_status}
                </dd>
              </div>
              <div>
                <dt>Order total</dt>
                <dd>{peso.format(selected.total)}</dd>
              </div>
              <div>
                <dt>Placed</dt>
                <dd>{philippineDateTime.format(new Date(selected.created_at))}</dd>
              </div>
            </dl>
            {selected.items && selected.items.length > 0 && (
              <section className="delivery-items">
                <h3>Ordered products</h3>
                {selected.items.map((item) => (
                  <div key={item.id ?? `${item.product_id}-${item.size}`}>
                    <span>
                      <strong>{item.product?.name ?? "Product"}</strong>
                      <small>
                        Size {item.size} · Quantity {item.quantity}
                      </small>
                    </span>
                    <b>{peso.format(item.price * item.quantity)}</b>
                  </div>
                ))}
              </section>
            )}
            <div className="delivery-contact-actions">
              <a href={`tel:${selected.phone}`} className="button button--outline">
                <Phone size={17} /> CALL CUSTOMER
              </a>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selected.address}, ${selected.city}`)}`}
                target="_blank"
                rel="noreferrer"
                className="button button--outline"
              >
                <Navigation size={17} /> OPEN MAPS
              </a>
            </div>
            {selected.status === "Out for Delivery" && (
              <>
                {selected.payment_method === "Cash on Delivery" && (
                  <label className="cash-confirmation">
                    <input
                      type="checkbox"
                      checked={cashCollected}
                      onChange={(event) => setCashCollected(event.target.checked)}
                    />
                    <span>
                      <strong>Cash collected</strong>
                      <small>
                        Confirm that {peso.format(selected.total)} was received from the customer.
                      </small>
                    </span>
                  </label>
                )}
                <button
                  className="button button--success button--full"
                  disabled={selected.payment_method === "Cash on Delivery" && !cashCollected}
                  onClick={async () => {
                    const result = await markDelivered(selected.id, cashCollected);
                    const payload = Array.isArray(result.data) ? result.data[0] : result.data;
                    if (result.error || !payload?.success) {
                      setNotice(
                        result.error?.message ??
                          payload?.message ??
                          "Delivery confirmation was rejected.",
                      );
                      return;
                    }
                    setNotice(payload.message ?? "Delivery confirmed successfully.");
                    setSelected(null);
                    await load();
                  }}
                >
                  <CheckCircle2 size={18} /> MARK AS DELIVERED
                </button>
              </>
            )}
            {selected.status !== "Out for Delivery" && selected.status !== "Delivered" && (
              <p className="permission-note">
                Dispatch status is controlled by an administrator. Riders can confirm delivery only
                after an order is Out for Delivery.
              </p>
            )}
          </article>
        </div>
      )}

      {notice && (
        <div className="toast">
          <span>{notice}</span>
          <button onClick={() => setNotice("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
