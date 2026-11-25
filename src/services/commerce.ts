import { supabase } from "../lib/supabase";
import type {
  CartItem,
  Order,
  OrderItem,
  Product,
  ProductReview,
  Profile,
  ReviewEligibility,
  RpcResult,
} from "../types/commerce";

const unwrap = <T>(data: T | T[] | null): T | null =>
  Array.isArray(data) ? (data[0] ?? null) : data;

const cartVariantStorageKey = (userId: string) => `diane-cart-variants:${userId}`;
const orderVariantStorageKey = (userId: string) => `diane-order-variants:${userId}`;
const variantKey = (productId: string, size: string) => `${productId}::${size}`;

type VariantMap = Record<string, string>;
type OrderVariantSnapshot = Record<string, Array<{ product_id: string; size: string; color: string }>>;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    return (parsed && typeof parsed === "object" ? parsed : fallback) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

export async function listProducts() {
  return supabase.from("products").select("*").order("created_at", { ascending: false });
}

export async function listCategories() {
  return supabase.from("categories").select("*").order("name");
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle<Profile>();
  return { data, error };
}

export async function updateCustomerProfile(
  userId: string,
  values: Pick<
    Profile,
    | "name"
    | "phone"
    | "default_delivery_address"
    | "default_delivery_landmark"
    | "default_delivery_city"
    | "default_delivery_zip"
  >,
) {
  return supabase.from("profiles").update(values).eq("id", userId);
}

export async function uploadCustomerAvatar(userId: string, file: File) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error("Choose a JPG, PNG, or WEBP profile photo.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Profile photos must be 5 MB or smaller.");
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/avatar.${extension}`;
  const upload = await supabase.storage
    .from("customer-profiles")
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
  if (upload.error) throw upload.error;
  const profileUpdate = await supabase
    .from("profiles")
    .update({ avatar_url: path })
    .eq("id", userId);
  if (profileUpdate.error) throw profileUpdate.error;
  return path;
}

export async function getCustomerAvatarUrl(path: string) {
  return supabase.storage.from("customer-profiles").createSignedUrl(path, 3600);
}

export async function listCart(userId: string) {
  // The original DIANE cart_items schema stores product, size and quantity.
  // Selected colour is retained in a per-user browser sidecar until a reviewed
  // database migration adds a persistent colour column to cart_items/order_items.
  const { data, error } = await supabase
    .from("cart_items")
    .select("id,user_id,product_id,size,quantity,product:products(*)")
    .eq("user_id", userId)
    .order("id");
  if (error) return { data: [] as CartItem[], error };

  const variants = readJson<VariantMap>(cartVariantStorageKey(userId), {});
  const rows = (data ?? []) as unknown as CartItem[];
  const validKeys = new Set(rows.map((item) => variantKey(item.product_id, item.size)));
  const cleanedVariants = Object.fromEntries(
    Object.entries(variants).filter(([key]) => validKeys.has(key)),
  );
  if (Object.keys(cleanedVariants).length !== Object.keys(variants).length) {
    writeJson(cartVariantStorageKey(userId), cleanedVariants);
  }

  return {
    data: rows.map((item) => ({
      ...item,
      color: item.color ?? cleanedVariants[variantKey(item.product_id, item.size)] ?? null,
    })),
    error: null,
  };
}

export async function addCartItem(
  userId: string,
  product: Product,
  size: string,
  color?: string,
) {
  if (!product.sizes?.includes(size)) {
    return { error: new Error("Please select a valid available size.") };
  }
  if (Number(product.stock) < 1) {
    return { error: new Error("This product is currently out of stock.") };
  }

  const { data: existing, error: readError } = await supabase
    .from("cart_items")
    .select("id,quantity")
    .eq("user_id", userId)
    .eq("product_id", product.id)
    .eq("size", size)
    .maybeSingle();
  if (readError) return { error: readError };

  const variants = readJson<VariantMap>(cartVariantStorageKey(userId), {});
  const key = variantKey(product.id, size);
  const existingColor = variants[key];
  if (existing && color && existingColor && existingColor !== color) {
    return {
      error: new Error(
        "Your existing cart table stores one colour per product and size. Remove the current item before adding this product in another colour.",
      ),
    };
  }

  const quantity = Number(existing?.quantity ?? 0) + 1;
  if (quantity > Number(product.stock) || quantity > 99) {
    return { error: new Error("The requested quantity is not available in stock.") };
  }

  const result = existing
    ? await supabase.from("cart_items").update({ quantity }).eq("id", existing.id)
    : await supabase.from("cart_items").insert({
        user_id: userId,
        product_id: product.id,
        size,
        quantity: 1,
      });

  if (result.error) return { error: result.error };

  if (color) variants[key] = color;
  writeJson(cartVariantStorageKey(userId), variants);
  return { error: null };
}

export async function updateCartQuantity(
  id: string,
  quantity: number,
  stockLimit?: number,
) {
  if (quantity > 0 && stockLimit !== undefined && quantity > stockLimit) {
    return { error: new Error(`Only ${stockLimit} item(s) are currently available.`) };
  }
  if (quantity > 99) return { error: new Error("A maximum of 99 pieces is allowed per cart item.") };
  if (quantity <= 0) return supabase.from("cart_items").delete().eq("id", id);
  return supabase.from("cart_items").update({ quantity }).eq("id", id);
}

export async function clearCart(userId: string) {
  const result = await supabase.from("cart_items").delete().eq("user_id", userId);
  if (!result.error) writeJson(cartVariantStorageKey(userId), {});
  return result;
}

export function saveOrderVariantSnapshot(userId: string, orderId: string, cart: CartItem[]) {
  const snapshots = readJson<OrderVariantSnapshot>(orderVariantStorageKey(userId), {});
  snapshots[orderId] = cart
    .filter((item): item is CartItem & { color: string } => Boolean(item.color))
    .map((item) => ({ product_id: item.product_id, size: item.size, color: item.color }));
  writeJson(orderVariantStorageKey(userId), snapshots);
}

function getOrderVariantSnapshot(userId: string, orderId: string) {
  const snapshots = readJson<OrderVariantSnapshot>(orderVariantStorageKey(userId), {});
  return snapshots[orderId] ?? [];
}

export async function listCustomerOrders(userId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !data) return { data: [] as Order[], error };
  const orders = data as Order[];
  const hydrated = await Promise.all(
    orders.map(async (order) => {
      const itemResult = await supabase
        .from("order_items")
        .select(
          "id,order_id,product_id,size,quantity,price,product:products(id,name,image,images,category)",
        )
        .eq("order_id", order.id);
      if (itemResult.error) throw itemResult.error;
      const variantSnapshot = getOrderVariantSnapshot(userId, order.id);
      const items = (itemResult.data ?? []) as unknown as OrderItem[];
      return {
        ...order,
        items: items.map((item) => ({
          ...item,
          color:
            item.color ??
            variantSnapshot.find(
              (variant) => variant.product_id === item.product_id && variant.size === item.size,
            )?.color ??
            null,
        })),
      };
    }),
  ).catch((itemError: unknown) => ({ __error: itemError } as const));

  if (!Array.isArray(hydrated)) {
    return {
      data: [] as Order[],
      error: hydrated.__error instanceof Error
        ? hydrated.__error
        : new Error("Unable to load order items."),
    };
  }
  return { data: hydrated as Order[], error: null };
}

export async function listRiderOrders(riderId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id,full_name,phone,address,landmark,city,zip,total,status,payment_method,payment_status,created_at,rider_id",
    )
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false });
  if (error || !data) return { data: [] as Order[], error };
  const orders = data as Order[];
  const hydrated = await Promise.all(
    orders.map(async (order) => {
      const itemResult = await supabase
        .from("order_items")
        .select(
          "id,order_id,product_id,size,quantity,price,product:products(id,name,image,images,category)",
        )
        .eq("order_id", order.id);
      if (itemResult.error) throw itemResult.error;
      return { ...order, items: (itemResult.data ?? []) as unknown as OrderItem[] };
    }),
  ).catch((itemError: unknown) => ({ __error: itemError } as const));
  if (!Array.isArray(hydrated)) {
    return {
      data: [] as Order[],
      error: hydrated.__error instanceof Error
        ? hydrated.__error
        : new Error("Unable to load assigned order items."),
    };
  }
  return { data: hydrated as Order[], error: null };
}

export async function listAdminData() {
  const [products, orders, customers, riders] = await Promise.all([
    supabase.from("products").select("*").order("created_at", { ascending: false }),
    supabase.from("orders").select("*").order("created_at", { ascending: false }),
    supabase.from("profiles").select("*").eq("role", "customer"),
    supabase.from("profiles").select("*").eq("role", "rider"),
  ]);
  return {
    products: (products.data ?? []) as Product[],
    orders: (orders.data ?? []) as Order[],
    customers: (customers.data ?? []) as Profile[],
    riders: (riders.data ?? []) as Profile[],
    error: products.error || orders.error || customers.error || riders.error,
  };
}

export async function checkout(order: Record<string, unknown>, items: unknown[]) {
  const { data, error } = await supabase.rpc("checkout_create_order", {
    p_order: order,
    p_items: items,
  });
  return { data: unwrap(data as RpcResult | RpcResult[] | null), error };
}

export async function confirmDemoPayment(orderId: string) {
  const { data, error } = await supabase.rpc("confirm_demo_payment", {
    p_order_id: orderId,
  });
  return { data: unwrap(data as RpcResult | RpcResult[] | null), error };
}

export async function updateAdminOrder(orderId: string, status: string) {
  const { data, error } = await supabase.rpc("admin_update_order_status", {
    p_order_id: orderId,
    p_new_status: status,
  });
  return { data: unwrap(data as RpcResult | RpcResult[] | null), error };
}

export async function assignOrderRider(orderId: string, riderId: string | null) {
  return supabase
    .from("orders")
    .update({ rider_id: riderId })
    .eq("id", orderId)
    .eq("status", "Shipped")
    .select("id,rider_id")
    .maybeSingle();
}

export async function markDelivered(orderId: string, paymentCollected: boolean) {
  const { data, error } = await supabase.rpc("rider_update_delivery", {
    p_order_id: orderId,
    p_new_status: "Delivered",
    p_payment_collected: paymentCollected,
  });
  return { data: unwrap(data as RpcResult | RpcResult[] | null), error };
}

export async function confirmReceived(orderId: string) {
  const { data, error } = await supabase.rpc("confirm_order_received", { p_order_id: orderId });
  return { data: unwrap(data as RpcResult | RpcResult[] | null), error };
}

export async function submitReview(productId: string, rating: number, comment: string) {
  const { data, error } = await supabase.rpc("submit_product_review", {
    p_product_id: productId,
    p_rating: rating,
    p_comment: comment,
  });
  return { data: unwrap(data as RpcResult | RpcResult[] | null), error };
}

export async function getProductReviews(productId: string) {
  const { data, error } = await supabase.rpc("get_product_reviews", {
    p_product_id: productId,
  });
  return { data: (data ?? []) as ProductReview[], error };
}

export async function getReviewEligibility(productId: string) {
  const { data, error } = await supabase.rpc("get_product_review_status", {
    p_product_id: productId,
  });
  return {
    data: (unwrap(data as ReviewEligibility | ReviewEligibility[] | null) ?? {
      can_review: false,
      already_reviewed: false,
      message: "Only customers who have received this product can write a review.",
    }) as ReviewEligibility,
    error,
  };
}

export async function saveWishlist(productIds: string[]) {
  return supabase.auth.updateUser({
    data: { diane_wishlist: productIds },
  });
}

export async function uploadProductImage(file: File) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error("Only JPG, PNG, and WEBP images are allowed.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Each image must be 5 MB or smaller.");
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `product-${crypto.randomUUID()}.${extension}`;
  const result = await supabase.storage
    .from("product-images")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  if (result.error) throw result.error;
  return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
}

export async function saveProduct(product: Product, existing: boolean) {
  if (existing) {
    return supabase.from("products").update(product).eq("id", product.id);
  }
  return supabase.from("products").insert(product);
}

export async function deleteProductSafely(productId: string) {
  const usage = await supabase.from("order_items").select("id").eq("product_id", productId).limit(1);
  if (usage.error) return { error: usage.error };
  if (usage.data?.length) {
    return { error: new Error("Products with order history cannot be deleted. You can edit or mark them unavailable instead.") };
  }
  return supabase.from("products").delete().eq("id", productId);
}

export interface RiderAdminPayload {
  action: "create" | "update" | "set_active";
  rider_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  active?: boolean;
}

export async function manageRider(payload: RiderAdminPayload) {
  const { data, error } = await supabase.functions.invoke("admin-riders", { body: payload });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.message ?? "The rider account operation was rejected.");
  return data as { success: boolean; message?: string; rider_id?: string };
}
