import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Camera, Heart, LogOut, MapPin, Package, Save, Star, UserRound } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { peso, philippineDate, productImage } from "../../lib/format";
import {
  confirmDemoPayment,
  confirmReceived,
  getCustomerAvatarUrl,
  getReviewEligibility,
  updateCustomerProfile,
  uploadCustomerAvatar,
} from "../../services/commerce";
import type { Order, Product } from "../../types/commerce";
import { EmptyState, LoadingState } from "../common/StateView";

type ProfileTab = "info" | "orders" | "reviews" | "wishlist";

export function CustomerProfile({
  orders,
  products,
  wishlist,
  onOpenProduct,
  onRefreshOrders,
  onNotice,
  onLogout,
  initialTab = "info",
}: {
  orders: Order[];
  products: Product[];
  wishlist: string[];
  onOpenProduct: (product: Product) => void;
  onRefreshOrders: () => Promise<void>;
  onNotice: (message: string) => void;
  onLogout: () => Promise<void>;
  initialTab?: ProfileTab;
}) {
  const { user, profile, refreshProfile } = useAuth();
  const [tab, setTab] = useState<ProfileTab>("info");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewed, setReviewed] = useState<Product[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [paymentBusyOrder, setPaymentBusyOrder] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let active = true;
    if (!profile?.avatar_url) {
      setAvatarUrl("");
      return;
    }
    void getCustomerAvatarUrl(profile.avatar_url).then(({ data, error }) => {
      if (active && !error) setAvatarUrl(data.signedUrl);
    });
    return () => {
      active = false;
    };
  }, [profile?.avatar_url]);

  const deliveredProductIds = useMemo(
    () =>
      Array.from(
        new Set(
          orders
            .filter((order) => order.status === "Delivered")
            .flatMap((order) => order.items ?? [])
            .map((item) => item.product_id),
        ),
      ),
    [orders],
  );

  useEffect(() => {
    if (!user || tab !== "reviews") return;
    let active = true;
    setReviewsLoading(true);
    void Promise.all(
      deliveredProductIds.map(async (productId) => ({
        productId,
        status: await getReviewEligibility(productId),
      })),
    ).then((results) => {
      if (!active) return;
      const reviewedIds = results
        .filter(({ status }) => status.data.already_reviewed)
        .map(({ productId }) => productId);
      setReviewed(products.filter((product) => reviewedIds.includes(product.id)));
      setReviewsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [deliveredProductIds, products, tab, user]);

  if (!user) return null;

  const saveInfo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const result = await updateCustomerProfile(user.id, {
      name: String(form.get("name")).trim(),
      phone: String(form.get("phone")).trim(),
      default_delivery_address: String(form.get("address")).trim(),
      default_delivery_landmark: String(form.get("landmark")).trim(),
      default_delivery_city: String(form.get("city")).trim(),
      default_delivery_zip: String(form.get("zip")).trim(),
    });
    if (result.error) {
      onNotice(result.error.message);
    } else {
      await refreshProfile();
      onNotice("Your DIANE profile information has been updated.");
    }
    setSaving(false);
  };

  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      const path = await uploadCustomerAvatar(user.id, file);
      const signed = await getCustomerAvatarUrl(path);
      if (signed.error) throw signed.error;
      setAvatarUrl(signed.data.signedUrl);
      await refreshProfile();
      onNotice("Your profile photo has been updated.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Unable to upload the profile photo.");
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const wishedProducts = products.filter((product) => wishlist.includes(product.id));

  return (
    <>
      <div className="profile-hero profile-hero--complete">
        <button
          className="profile-photo"
          onClick={() => fileRef.current?.click()}
          disabled={avatarBusy}
          aria-label="Upload profile photo"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={`${profile?.name || "Customer"} profile`} />
          ) : (
            <span>{(profile?.name || user.email || "D").slice(0, 1)}</span>
          )}
          <i>
            <Camera size={14} />
          </i>
        </button>
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void uploadAvatar(event.target.files?.[0])}
        />
        <div>
          <span className="eyebrow">YOUR DIANE</span>
          <h1>{profile?.name || "Welcome back"}</h1>
          <p>{profile?.email || user.email}</p>
          <small>{avatarBusy ? "Uploading photo…" : "Tap the photo to update it"}</small>
        </div>
        <button
          className="text-button profile-logout"
          type="button"
          onClick={async () => {
            try {
              await onLogout();
            } catch (error) {
              onNotice(error instanceof Error ? `Unable to sign out: ${error.message}` : "Unable to sign out. Please try again.");
            }
          }}
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>

      <nav className="profile-tabs">
        {[
          ["info", UserRound, "Personal"],
          ["orders", Package, "Orders"],
          ["reviews", Star, "Reviews"],
          ["wishlist", Heart, "Wishlist"],
        ].map(([key, Icon, label]) => (
          <button
            key={String(key)}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key as ProfileTab)}
          >
            <Icon size={15} /> {String(label)}
          </button>
        ))}
      </nav>

      {tab === "info" && (
        <form className="customer-profile-form" onSubmit={saveInfo}>
          <div className="profile-section-title">
            <span className="eyebrow">PERSONAL INFORMATION</span>
            <h2>Account details</h2>
            <p>These details are used to prepare your checkout and delivery information.</p>
          </div>
          <div className="profile-form-grid">
            <label>
              Full name
              <input name="name" defaultValue={profile?.name ?? ""} maxLength={120} required />
            </label>
            <label>
              Email address
              <input value={profile?.email || user.email || ""} disabled />
            </label>
            <label>
              Contact number
              <input
                name="phone"
                defaultValue={profile?.phone ?? ""}
                inputMode="tel"
                maxLength={20}
              />
            </label>
            <label>
              City
              <input
                name="city"
                defaultValue={profile?.default_delivery_city ?? ""}
                maxLength={100}
              />
            </label>
            <label className="profile-form-wide">
              Delivery address
              <input
                name="address"
                defaultValue={profile?.default_delivery_address ?? ""}
                maxLength={250}
              />
            </label>
            <label>
              Landmark
              <input
                name="landmark"
                defaultValue={profile?.default_delivery_landmark ?? ""}
                maxLength={180}
              />
            </label>
            <label>
              ZIP code
              <input name="zip" defaultValue={profile?.default_delivery_zip ?? ""} maxLength={20} />
            </label>
          </div>
          <button className="button button--dark" disabled={saving}>
            <Save size={15} /> {saving ? "SAVING…" : "SAVE PROFILE"}
          </button>
        </form>
      )}

      {tab === "orders" && (
        <div className="orders-section">
          <div className="profile-section-title">
            <span className="eyebrow">ORDER HISTORY</span>
            <h2>My orders</h2>
          </div>
          {orders.length === 0 ? (
            <EmptyState title="No orders yet" body="Your DIANE order history will appear here." />
          ) : (
            orders.map((order) => (
              <article className="order-card" key={order.id}>
                <div>
                  <span>ORDER {order.id.toUpperCase()}</span>
                  <strong>{order.status}</strong>
                </div>
                <h3>{peso.format(order.total)}</h3>
                <p>
                  {philippineDate.format(new Date(order.created_at))} · {order.payment_method} ·{" "}
                  {order.payment_status}
                </p>
                {order.items && order.items.length > 0 && (
                  <div className="order-items">
                    {order.items.map((item) => (
                      <div key={item.id ?? `${item.product_id}-${item.size}`}>
                        <img
                          src={productImage(item.product?.image || item.product?.images?.[0])}
                          alt=""
                        />
                        <span>
                          <strong>{item.product?.name ?? "Product"}</strong>
                          <small>
                            Size {item.size}{item.color ? ` · ${item.color}` : ""} · Qty {item.quantity}
                          </small>
                        </span>
                        <b>{peso.format(item.price * item.quantity)}</b>
                      </div>
                    ))}
                  </div>
                )}
                <div className="order-progress">
                  {["Processing", "Confirmed", "Shipped", "Out for Delivery", "Delivered"].map(
                    (step) => (
                      <i
                        key={step}
                        className={
                          [
                            "Processing",
                            "Confirmed",
                            "Shipped",
                            "Out for Delivery",
                            "Delivered",
                          ].indexOf(step) <=
                          [
                            "Processing",
                            "Confirmed",
                            "Shipped",
                            "Out for Delivery",
                            "Delivered",
                          ].indexOf(order.status)
                            ? "done"
                            : ""
                        }
                      />
                    ),
                  )}
                </div>
                <p className="delivery-address">
                  <MapPin size={13} /> {order.address}, {order.city} {order.zip}
                </p>
                {order.status === "Delivered" && !order.received_at && (
                  <button
                    className="button button--outline"
                    onClick={async () => {
                      const result = await confirmReceived(order.id);
                      const payload = Array.isArray(result.data) ? result.data[0] : result.data;
                      if (result.error || !payload?.success) {
                        onNotice(
                          result.error?.message ??
                            payload?.message ??
                            "Receipt confirmation was rejected.",
                        );
                        return;
                      }
                      onNotice(payload.message ?? "Order receipt confirmed.");
                      await onRefreshOrders();
                    }}
                  >
                    CONFIRM ORDER RECEIVED
                  </button>
                )}
                {(["GCash", "Maya"].includes(order.payment_method) &&
                  order.payment_status === "pending_verification") && (
                  <div className="demo-payment-action">
                    <p>
                      School-project demo only. This confirms the simulated payment status; it does
                      not transfer money through GCash or Maya.
                    </p>
                    <button
                      className="button button--outline"
                      disabled={paymentBusyOrder === order.id}
                      onClick={async () => {
                        setPaymentBusyOrder(order.id);
                        const result = await confirmDemoPayment(order.id);
                        if (result.error || !result.data?.success) {
                          onNotice(
                            result.error?.message ??
                              result.data?.message ??
                              "Demo payment confirmation was rejected.",
                          );
                        } else {
                          onNotice(result.data.message ?? "Demo payment confirmed.");
                          await onRefreshOrders();
                        }
                        setPaymentBusyOrder(null);
                      }}
                    >
                      {paymentBusyOrder === order.id ? "CONFIRMING…" : "CONFIRM DEMO PAYMENT"}
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      )}

      {tab === "reviews" && (
        <section className="profile-collection">
          <div className="profile-section-title">
            <span className="eyebrow">VERIFIED FEEDBACK</span>
            <h2>My reviews</h2>
            <p>Products the existing review eligibility RPC confirms you have already reviewed. Open a product to view its published review list.</p>
          </div>
          {reviewsLoading ? (
            <LoadingState label="Loading your review history" />
          ) : reviewed.length === 0 ? (
            <EmptyState
              title="No submitted reviews yet"
              body="Eligible delivered products can be reviewed from their Product Details page."
            />
          ) : (
            <div className="profile-product-list">
              {reviewed.map((product) => (
                <button key={product.id} onClick={() => onOpenProduct(product)}>
                  <img src={productImage(product.image || product.images?.[0])} alt="" />
                  <span>
                    <strong>{product.name}</strong>
                    <small>
                      <Star size={11} fill="currentColor" /> Your review is submitted
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "wishlist" && (
        <section className="profile-collection">
          <div className="profile-section-title">
            <span className="eyebrow">SAVED PIECES</span>
            <h2>My wishlist</h2>
          </div>
          {wishedProducts.length === 0 ? (
            <EmptyState
              title="Your wishlist is waiting"
              body="Save products with the heart icon to see them here."
            />
          ) : (
            <div className="profile-product-list">
              {wishedProducts.map((product) => (
                <button key={product.id} onClick={() => onOpenProduct(product)}>
                  <img src={productImage(product.image || product.images?.[0])} alt="" />
                  <span>
                    <strong>{product.name}</strong>
                    <small>{peso.format(product.price)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
