import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  Star,
  Truck,
  UserRound,
  X,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ProductManager } from "../components/admin/ProductManager";
import { RiderManager } from "../components/admin/RiderManager";
import { Brand } from "../components/common/Brand";
import { EmptyState, ErrorState, LoadingState } from "../components/common/StateView";
import { useAuth } from "../contexts/AuthContext";
import { peso, philippineDate } from "../lib/format";
import { supabase } from "../lib/supabase";
import {
  assignOrderRider,
  getProductReviews,
  listAdminData,
  updateAdminOrder,
} from "../services/commerce";
import type { Order, Product, ProductReview, Profile } from "../types/commerce";

type AdminSection =
  | "Dashboard"
  | "Products"
  | "Add Product"
  | "Orders"
  | "Customers"
  | "Riders"
  | "Payments"
  | "Reviews"
  | "Reports"
  | "Users"
  | "Settings";

const nav = [
  ["Dashboard", LayoutDashboard],
  ["Products", Package],
  ["Add Product", Plus],
  ["Orders", ShoppingBag],
  ["Customers", Users],
  ["Riders", Truck],
  ["Payments", CreditCard],
  ["Reviews", Star],
  ["Reports", BarChart3],
  ["Users", UserRound],
  ["Settings", Settings],
] as const;

export function AdminApp({
  onLogout,
}: {
  onLogout: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const [section, setSection] = useState<AdminSection>(() => {
    const allowed: AdminSection[] = ["Dashboard", "Products", "Add Product", "Orders", "Customers", "Riders", "Payments", "Reviews", "Reports", "Users", "Settings"];
    try {
      const saved = localStorage.getItem(`diane-admin-section:${profile?.id ?? "account"}`);
      if (saved && allowed.includes(saved as AdminSection)) return saved as AdminSection;
    } catch { /* Use the default section when storage is unavailable. */ }
    return "Dashboard";
  });

  useEffect(() => {
    try {
      localStorage.setItem(`diane-admin-section:${profile?.id ?? "account"}`, section);
    } catch { /* Page persistence is optional; admin operations remain available. */ }
  }, [section, profile?.id]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Profile[]>([]);
  const [riders, setRiders] = useState<Profile[]>([]);
  const [reviews, setReviews] = useState<Array<ProductReview & { product: Product }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");

  // Keep the mobile navigation drawer self-contained and dismissible.
  useEffect(() => {
    if (!mobileMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen]);

  // If the viewport becomes desktop-sized while the drawer is open, close it.
  useEffect(() => {
    const media = window.matchMedia("(max-width: 780px)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileMenuOpen(false);
    };
    media.addEventListener("change", handleViewportChange);
    return () => media.removeEventListener("change", handleViewportChange);
  }, []);

  const load = async () => {
    setLoading(true);
    const data = await listAdminData();
    setProducts(data.products);
    setOrders(data.orders);
    setCustomers(data.customers);
    setRiders(data.riders);
    if (!data.error) {
      const reviewResults = await Promise.all(
        data.products.map(async (product) => ({
          product,
          result: await getProductReviews(product.id),
        })),
      );
      setReviews(
        reviewResults.flatMap(({ product, result }) =>
          result.data.map((review) => ({ ...review, product })),
        ),
      );
    }
    setError(data.error?.message ?? "");
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("diane-admin-operations")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => void load())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // Admin operations share one live channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const delivered = orders.filter((order) => order.status === "Delivered");
  const revenue = delivered.reduce((sum, order) => sum + Number(order.total), 0);
  const statusCount = (status: string) => orders.filter((order) => order.status === status).length;
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) =>
        `${order.id} ${order.full_name} ${order.status}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [orders, query],
  );

  const handleLogout = async () => {
    setAccountMenuOpen(false);
    setMobileMenuOpen(false);
    try {
      await onLogout();
    } catch (error) {
      setNotice(error instanceof Error ? `Unable to sign out: ${error.message}` : "Unable to sign out. Please try again.");
    }
  };

  return (
    <div className={`admin-app ${collapsed ? "admin-app--collapsed" : ""} ${mobileMenuOpen ? "admin-app--mobile-open" : ""}`}>
      {mobileMenuOpen && (
        <button
          type="button"
          className="admin-mobile-backdrop"
          aria-label="Close admin navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside className="admin-sidebar" id="admin-navigation-drawer" aria-label="Admin navigation">
        <div className="admin-brand">
          <Brand light />
        </div>
        <button
          type="button"
          className="collapse-button"
          onClick={() => {
            if (window.matchMedia("(max-width: 780px)").matches) setMobileMenuOpen(false);
            else setCollapsed((value) => !value);
          }}
          aria-label={mobileMenuOpen ? "Close admin menu" : "Collapse admin sidebar"}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
        <nav id="admin-navigation">
          {nav.map(([label, Icon]) => (
            <button
              key={label}
              className={section === label ? "active" : ""}
              onClick={() => {
                setSection(label);
                setMobileMenuOpen(false);
                setAccountMenuOpen(false);
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar__footer">
          <div className="admin-avatar">{profile?.name?.slice(0, 1) || "A"}</div>
          <div>
            <strong>{profile?.name || "Administrator"}</strong>
            <span>Store admin</span>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <button
            type="button"
            className="admin-mobile-menu-button"
            aria-label="Open admin menu"
            aria-controls="admin-navigation-drawer"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div>
            <span>DIANE / {section.toUpperCase()}</span>
            <h1>{section}</h1>
          </div>
          <div className="admin-topbar__actions">
            <label>
              <Search size={17} />
              <input
                placeholder="Search store records"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="icon-button">
              <Bell size={19} />
            </button>
            <div className={`admin-account-wrap ${accountMenuOpen ? "is-open" : ""}`}>
              <button
                className="admin-account"
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                onClick={() => setAccountMenuOpen((open) => !open)}
              >
                {profile?.name || "Admin"} <ChevronDown size={14} />
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
                      <strong>{profile?.name || "Administrator"}</strong>
                      <span>Store admin</span>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleLogout()}
                    >
                      <LogOut size={16} /> Log Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {loading && <LoadingState label="Loading live store operations" />}
        {error && <ErrorState message={error} />}

        {!loading && !error && section === "Dashboard" && (
          <>
            <section className="admin-welcome">
              <div>
                <span className="eyebrow">STORE OVERVIEW</span>
                <h2>Good day, {profile?.name?.split(" ")[0] || "Admin"}.</h2>
                <p>A live view of DIANE commerce and delivery operations.</p>
              </div>
              <span>{philippineDate.format(new Date())}</span>
            </section>
            <section className="admin-stat-grid">
              {(
                [
                  {
                    label: "Total revenue",
                    value: peso.format(revenue),
                    icon: CircleDollarSign,
                    note: `${delivered.length} delivered orders`,
                  },
                  {
                    label: "Total orders",
                    value: orders.length,
                    icon: ShoppingBag,
                    note: `${statusCount("Processing")} need review`,
                  },
                  {
                    label: "Products",
                    value: products.length,
                    icon: Package,
                    note: `${products.filter((p) => p.stock < 5).length} low stock`,
                  },
                  {
                    label: "Customers",
                    value: customers.length,
                    icon: Users,
                    note: "Registered customer accounts",
                  },
                ] satisfies Array<{
                  label: string;
                  value: string | number;
                  icon: LucideIcon;
                  note: string;
                }>
              ).map(({ label, value, icon: Icon, note }) => (
                <article key={label}>
                  <div>
                    <span>{label}</span>
                    <Icon size={18} />
                  </div>
                  <strong>{value}</strong>
                  <p>{note}</p>
                </article>
              ))}
            </section>
            <section className="admin-dashboard-grid">
              <article className="admin-panel order-overview">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow">FULFILMENT</span>
                    <h2>Order overview</h2>
                  </div>
                </div>
                <div className="status-bars">
                  {["Processing", "Confirmed", "Shipped", "Out for Delivery", "Delivered"].map(
                    (status) => (
                      <div key={status}>
                        <span>{status}</span>
                        <div>
                          <i
                            style={{
                              width: `${orders.length ? Math.max(4, (statusCount(status) / orders.length) * 100) : 0}%`,
                            }}
                          />
                        </div>
                        <strong>{statusCount(status)}</strong>
                      </div>
                    ),
                  )}
                </div>
              </article>
              <article className="admin-panel rider-summary">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow">LOGISTICS</span>
                    <h2>Rider network</h2>
                  </div>
                </div>
                <strong>{riders.length}</strong>
                <p>registered delivery partners</p>
                <div>
                  <span>Active riders</span>
                  <b>{riders.filter((r) => r.active !== false).length}</b>
                </div>
                <div>
                  <span>Out for delivery</span>
                  <b>{statusCount("Out for Delivery")}</b>
                </div>
              </article>
            </section>
            <OrderTable orders={orders.slice(0, 8)} riders={riders} onUpdated={load} onNotice={setNotice} />
          </>
        )}

        {!loading && !error && section === "Orders" && (
          <OrderTable orders={filteredOrders} riders={riders} onUpdated={load} onNotice={setNotice} full />
        )}

        {!loading && !error && (section === "Products" || section === "Add Product") && (
          <ProductManager
            products={products}
            initialCreate={section === "Add Product"}
            onRefresh={load}
          />
        )}

        {!loading && !error && section === "Customers" && (
          <PeopleTable title="Customers" people={customers} />
        )}
        {!loading && !error && section === "Riders" && (
          <RiderManager riders={riders} onRefresh={load} search={query} />
        )}

        {!loading && !error && section === "Payments" && (
          <DataSection title="Order payment statuses" count={orders.length}>
            <p className="field-help">This screen displays the payment status recorded on each order. GCash and Maya are simulated school-project demo payments; no real wallet transfer or payment-proof review is performed here.</p>
            <article className="admin-panel admin-table-panel">
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Method</th>
                      <th>Status</th>
                      <th>Amount</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td>#{order.id}</td>
                        <td>{order.full_name}</td>
                        <td>{order.payment_method}</td>
                        <td>
                          <strong>{order.payment_status}</strong>
                        </td>
                        <td>{peso.format(order.total)}</td>
                        <td>{philippineDate.format(new Date(order.created_at))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </DataSection>
        )}

        {!loading && !error && section === "Reviews" && (
          <DataSection title="Customer reviews" count={reviews.length}>
            {reviews.length === 0 ? (
              <EmptyState
                title="No reviews available"
                body="Verified product reviews will appear here."
              />
            ) : (
              <div className="admin-review-list">
                {reviews.map((review, index) => (
                  <article key={review.id ?? index}>
                    <div>
                      <span>{review.product.name}</span>
                      <strong>{review.rating} / 5</strong>
                    </div>
                    <h3>{review.display_name || review.customer_name || review.reviewer_name || "DIANE Customer"}</h3>
                    <p>{review.comment}</p>
                    <small>
                      {review.created_at || review.review_date
                        ? philippineDate.format(new Date(review.created_at || review.review_date!))
                        : "Date unavailable"}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </DataSection>
        )}

        {!loading && !error && section === "Reports" && (
          <DataSection title="Commerce reports" count={orders.length}>
            <div className="report-grid">
              <article>
                <span>DELIVERED REVENUE</span>
                <strong>{peso.format(revenue)}</strong>
                <p>Excludes pending and cancelled orders.</p>
              </article>
              <article>
                <span>AVERAGE ORDER</span>
                <strong>
                  {peso.format(
                    orders.length
                      ? orders.reduce((sum, order) => sum + Number(order.total), 0) / orders.length
                      : 0,
                  )}
                </strong>
                <p>Across all recorded orders.</p>
              </article>
              <article>
                <span>DELIVERY RATE</span>
                <strong>
                  {orders.length ? Math.round((delivered.length / orders.length) * 100) : 0}%
                </strong>
                <p>{delivered.length} successfully delivered.</p>
              </article>
              <article>
                <span>CANCELLATION RATE</span>
                <strong>
                  {orders.length ? Math.round((statusCount("Cancelled") / orders.length) * 100) : 0}
                  %
                </strong>
                <p>{statusCount("Cancelled")} cancelled orders.</p>
              </article>
            </div>
            <article className="admin-panel report-breakdown">
              <div className="panel-title">
                <div>
                  <span className="eyebrow">PAYMENT MIX</span>
                  <h2>Orders by payment method</h2>
                </div>
              </div>
              {["GCash", "Maya", "Cash on Delivery"].map((method) => {
                const count = orders.filter((order) => order.payment_method === method).length;
                return (
                  <div key={method}>
                    <span>{method}</span>
                    <i>
                      <b
                        style={{ width: `${orders.length ? (count / orders.length) * 100 : 0}%` }}
                      />
                    </i>
                    <strong>{count}</strong>
                  </div>
                );
              })}
            </article>
          </DataSection>
        )}

        {!loading && !error && section === "Users" && (
          <PeopleTable title="Registered users" people={[...customers, ...riders]} />
        )}

        {!loading && !error && section === "Settings" && (
          <DataSection title="Store configuration" count={3}>
            <div className="report-grid">
              <article className="admin-panel">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow">STORE PROFILE</span>
                    <h2>DIANE Clothing Shop</h2>
                  </div>
                  <ShoppingBag size={20} />
                </div>
                <p>Store identity currently used by the admin application.</p>
                <div className="settings-readonly-row">
                  <span>Store name</span><strong>DIANE Clothing Shop</strong>
                </div>
                <div className="settings-readonly-row">
                  <span>Configuration mode</span><strong>View only</strong>
                </div>
              </article>

              <article className="admin-panel">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow">ADMIN ACCOUNT</span>
                    <h2>Account information</h2>
                  </div>
                  <UserRound size={20} />
                </div>
                <div className="settings-readonly-row">
                  <span>Name</span><strong>{profile?.name || "Not available"}</strong>
                </div>
                <div className="settings-readonly-row">
                  <span>Email</span><strong>{profile?.email || "Not available"}</strong>
                </div>
                <div className="settings-readonly-row">
                  <span>Role</span><strong>{profile?.role || "Not available"}</strong>
                </div>
              </article>

              <article className="admin-panel">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow">PAYMENT ACTIVITY</span>
                    <h2>Methods recorded in orders</h2>
                  </div>
                  <CreditCard size={20} />
                </div>
                {Array.from(new Set(orders.map((order) => order.payment_method).filter(Boolean))).length ? (
                  Array.from(new Set(orders.map((order) => order.payment_method).filter(Boolean))).map((method) => (
                    <div className="settings-readonly-row" key={method}>
                      <span>{method}</span><strong>Found in order records</strong>
                    </div>
                  ))
                ) : (
                  <p>No payment methods are available in the loaded order records.</p>
                )}
                <p>These are historical order values, not a list of payment methods that can currently be enabled or disabled.</p>
              </article>

              <article className="admin-panel">
                <div className="panel-title">
                  <div>
                    <span className="eyebrow">DELIVERY CONFIGURATION</span>
                    <h2>Delivery rules</h2>
                  </div>
                  <Truck size={20} />
                </div>
                <p>The current supplied backend schema does not expose an authorized store delivery-settings record. Existing order and rider workflows are left unchanged.</p>
                <div className="settings-readonly-row">
                  <span>Editable delivery fee</span><strong>Not configured here</strong>
                </div>
              </article>
            </div>
            <p className="settings-footnote">Read-only overview. No settings are saved or changed from this page.</p>
          </DataSection>
        )}
      </main>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss message">×</button>
        </div>
      )}
    </div>
  );
}

function DataSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="admin-data-section">
      <div>
        <span className="eyebrow">DIANE OPERATIONS</span>
        <h2>{title}</h2>
        <p>{count} records</p>
      </div>
      {children}
    </section>
  );
}

function OrderTable({
  orders,
  riders,
  onUpdated,
  onNotice,
  full = false,
}: {
  orders: Order[];
  riders: Profile[];
  onUpdated: () => Promise<void>;
  onNotice: (message: string) => void;
  full?: boolean;
}) {
  return (
    <article className="admin-panel admin-table-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">{full ? "ORDER MANAGEMENT" : "LIVE ACTIVITY"}</span>
          <h2>{full ? "All orders" : "Recent orders"}</h2>
        </div>
        <span>{orders.length} records</span>
      </div>
      {orders.length === 0 ? (
        <EmptyState title="No orders found" body="Customer orders will appear here after a successful checkout." />
      ) : <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Rider</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>#{order.id.slice(0, 8).toUpperCase()}</td>
                <td>
                  <strong>{order.full_name}</strong>
                  <span>{order.city}</span>
                </td>
                <td>{philippineDate.format(new Date(order.created_at))}</td>
                <td>{peso.format(order.total)}</td>
                <td>
                  <strong>{order.payment_method}</strong>
                  <span>{order.payment_status}</span>
                </td>
                <td>
                  {order.status === "Delivered" ? (
                    <strong>Delivered by rider</strong>
                  ) : (
                    <select
                      value={order.status}
                      aria-label={`Status for ${order.id}`}
                      onChange={async (event) => {
                        const nextStatus = event.target.value;
                        if (nextStatus === "Out for Delivery" && !order.rider_id) {
                          onNotice("Assign an active rider before dispatching this order.");
                          return;
                        }
                        const result = await updateAdminOrder(order.id, nextStatus);
                        if (result.error || result.data?.success === false) {
                          onNotice(result.error?.message ?? result.data?.message ?? "The order status was not updated.");
                          return;
                        }
                        onNotice(result.data?.message ?? `Order status updated to ${nextStatus}.`);
                        await onUpdated();
                      }}
                    >
                      {["Processing", "Confirmed", "Shipped", "Out for Delivery", "Cancelled"].map((status) => (
                        <option key={status} value={status} disabled={status === "Out for Delivery" && !order.rider_id}>
                          {status}{status === "Out for Delivery" && !order.rider_id ? " (assign rider first)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  {order.status === "Shipped" ? (
                    <select
                      value={order.rider_id ?? ""}
                      aria-label={`Rider for ${order.id}`}
                      onChange={async (event) => {
                        const result = await assignOrderRider(order.id, event.target.value || null);
                        if (result.error || !result.data) {
                          onNotice(result.error?.message ?? "The rider assignment was not saved. Check that the order is still Shipped.");
                          return;
                        }
                        onNotice("Rider assignment saved.");
                        await onUpdated();
                      }}
                    >
                      <option value="">Unassigned</option>
                      {riders
                        .filter((rider) => rider.active !== false)
                        .map((rider) => (
                          <option value={rider.id} key={rider.id}>
                            {rider.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <span>{riders.find((rider) => rider.id === order.rider_id)?.name ?? "—"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </article>
  );
}

function PeopleTable({ title, people }: { title: string; people: Profile[] }) {
  return (
    <DataSection title={title} count={people.length}>
      <article className="admin-panel admin-table-panel">
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td>
                    <strong>{person.name}</strong>
                  </td>
                  <td>{person.email}</td>
                  <td>{person.phone || "—"}</td>
                  <td>{person.role}</td>
                  <td>{person.active === false ? "Inactive" : "Active"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </DataSection>
  );
}
