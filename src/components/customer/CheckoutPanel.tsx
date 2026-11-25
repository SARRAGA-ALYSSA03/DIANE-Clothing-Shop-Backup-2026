import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, LockKeyhole, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { peso } from "../../lib/format";
import { checkout, clearCart, saveOrderVariantSnapshot } from "../../services/commerce";
import type { CartItem } from "../../types/commerce";
import { clearFormDraft, restoreFormDraft, saveFormDraft } from "../../lib/formDraft";

function generateOrderId() {
  const bytes = new Uint8Array(4);

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  const suffix = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("").toUpperCase();

  return `ORD-${suffix}`;
}

export function CheckoutPanel({
  cart,
  onClose,
  onViewOrders,
  onComplete,
}: {
  cart: CartItem[];
  onClose: () => void;
  onViewOrders: () => void;
  onComplete: () => Promise<void>;
}) {
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [orderId, setOrderId] = useState("");
  const [confirmationNote, setConfirmationNote] = useState("");
  const checkoutFormRef = useRef<HTMLFormElement>(null);
  const checkoutDraftKey = user ? `diane:customer:${user.id}:checkout:draft` : null;
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    if (!checkoutDraftKey || !checkoutFormRef.current) return;
    setDraftRestored(restoreFormDraft(checkoutDraftKey, checkoutFormRef.current));
  }, [checkoutDraftKey]);
  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.product?.price ?? 0) * item.quantity,
    0,
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || busy) return;
    if (cart.length === 0) {
      setError("Your shopping bag is empty.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payment = String(form.get("payment_method"));
    const fullName = String(form.get("full_name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const address = String(form.get("address") ?? "").trim();
    const city = String(form.get("city") ?? "").trim();
    const zip = String(form.get("zip") ?? "").trim();

    if (!fullName || !address || !city || !zip) {
      setError("Complete your name and delivery address before placing the order.");
      setBusy(false);
      return;
    }
    if (!/^[0-9+()\s.\-]{7,20}$/.test(phone) || phone.replace(/\D/g, "").length < 7) {
      setError("Enter a valid contact number using 7 to 15 digits.");
      setBusy(false);
      return;
    }
    if (!["Cash on Delivery", "GCash", "Maya"].includes(payment)) {
      setError("Choose one of the available payment methods.");
      setBusy(false);
      return;
    }

    const generatedId = generateOrderId();
    const order = {
      id: generatedId,
      user_id: user.id,
      total: Math.round(subtotal * 100) / 100,
      status: "Processing",
      full_name: fullName,
      phone,
      address,
      landmark: String(form.get("landmark") ?? "").trim(),
      city,
      zip,
      payment_method: payment,
      payment_status:
        payment === "Cash on Delivery" ? "unpaid_on_delivery" : "pending_verification",
    };
    const items = cart.map((item) => ({
      product_id: item.product_id,
      size: item.size,
      quantity: item.quantity,
      price: Number(item.product?.price ?? 0),
    }));

    const result = await checkout(order, items);
    if (result.error || !result.data?.success || !result.data.order_id) {
      setError(
        result.error?.message ?? result.data?.message ?? "DIANE could not create this order.",
      );
      setBusy(false);
      return;
    }

    clearFormDraft(checkoutDraftKey);
    setDraftRestored(false);
    const savedOrderId = String(result.data.order_id);
    saveOrderVariantSnapshot(user.id, savedOrderId, cart);
    const clearResult = await clearCart(user.id);
    if (clearResult.error) {
      setConfirmationNote(
        "Your order was created, but DIANE could not clear the shopping bag automatically. Please review your bag before placing another order.",
      );
    }
    setOrderId(savedOrderId);
    await onComplete();
    setBusy(false);
  };

  return (
    <div className="checkout-backdrop">
      <section className="checkout-panel">
        <header>
          <div>
            <span className="eyebrow">SECURE CHECKOUT</span>
            <h2>{orderId ? "Order confirmed" : "Delivery & payment"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close checkout">
            <X />
          </button>
        </header>
        {orderId ? (
          <div className="order-confirmation">
            <CheckCircle2 size={38} />
            <span className="eyebrow">THANK YOU FOR SHOPPING DIANE</span>
            <h3>Your order has been placed.</h3>
            <p>
              Order ID <strong>{orderId}</strong>
            </p>
            <p>
              The order is Processing. Payment and delivery updates are available in My Orders.
            </p>
            {confirmationNote && <div className="form-message">{confirmationNote}</div>}
            <button className="button button--dark button--full" onClick={onViewOrders}>
              VIEW MY ORDERS
            </button>
          </div>
        ) : (
          <form
            ref={checkoutFormRef}
            className="checkout-form"
            onSubmit={submit}
            onInput={(event) => saveFormDraft(checkoutDraftKey, event.currentTarget)}
            onChange={(event) => saveFormDraft(checkoutDraftKey, event.currentTarget)}
          >
            <fieldset>
              <legend>01 / CUSTOMER INFORMATION</legend>
              <label>
                Full name
                <input
                  name="full_name"
                  defaultValue={profile?.name ?? ""}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                Contact number
                <input
                  name="phone"
                  defaultValue={profile?.phone ?? ""}
                  maxLength={20}
                  inputMode="tel"
                  required
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>02 / DELIVERY ADDRESS</legend>
              <label>
                Street address
                <input
                  name="address"
                  defaultValue={profile?.default_delivery_address ?? ""}
                  maxLength={250}
                  required
                />
              </label>
              <label>
                Landmark <small>Optional</small>
                <input
                  name="landmark"
                  defaultValue={profile?.default_delivery_landmark ?? ""}
                  maxLength={180}
                />
              </label>
              <div>
                <label>
                  City
                  <input
                    name="city"
                    defaultValue={profile?.default_delivery_city ?? ""}
                    maxLength={100}
                    required
                  />
                </label>
                <label>
                  ZIP code
                  <input
                    name="zip"
                    defaultValue={profile?.default_delivery_zip ?? ""}
                    maxLength={20}
                    required
                  />
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend>03 / PAYMENT</legend>
              {(["Cash on Delivery", "GCash", "Maya"] as const).map((method) => (
                <label className="payment-option" key={method}>
                  <input
                    type="radio"
                    name="payment_method"
                    value={method}
                    defaultChecked={method === "Cash on Delivery"}
                  />
                  <span>
                    <strong>{method}</strong>
                    <small>
                      {method === "Cash on Delivery"
                        ? "Pay your rider upon delivery"
                        : "School-project demo payment; no real wallet transfer is made"}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <aside className="checkout-summary">
              <h3>Order summary</h3>
              {cart.map((item) => (
                <div key={item.id}>
                  <span>
                    {item.product?.name} × {item.quantity}
                    <small>
                      Size {item.size}{item.color ? ` · ${item.color}` : ""}
                    </small>
                  </span>
                  <strong>{peso.format(Number(item.product?.price ?? 0) * item.quantity)}</strong>
                </div>
              ))}
              <div className="checkout-total">
                <span>Total</span>
                <strong>{peso.format(subtotal)}</strong>
              </div>
            </aside>
            {error && <div className="form-message form-message--error">{error}</div>}
            <p className="field-help">
              {draftRestored
                ? "Your unfinished checkout details were restored from this device."
                : "Unfinished checkout details are saved automatically on this device and cleared after a successful order."}
            </p>
            <button className="button button--dark button--full" disabled={busy || cart.length === 0}>
              <LockKeyhole size={16} />{" "}
              {busy ? "CREATING ORDER…" : `PLACE ORDER · ${peso.format(subtotal)}`}
            </button>
            <p className="checkout-note">
              Order confirmation appears only after the existing checkout RPC succeeds. GCash and
              Maya are simulated demo payments in this school-project version.
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
