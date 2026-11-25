export type Role = "customer" | "rider" | "admin";

export interface Profile {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  avatar_url?: string | null;
  default_delivery_address?: string | null;
  default_delivery_landmark?: string | null;
  default_delivery_city?: string | null;
  default_delivery_zip?: string | null;
  active?: boolean | null;
}

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  gender?: string | null;
  price: number;
  original_price?: number | null;
  image?: string | null;
  images?: string[] | null;
  tryon_image?: string | null;
  sizes?: string[] | null;
  colors?: string[] | string | null;
  material?: string | null;
  stock: number;
  rating?: number | null;
  review_count?: number | null;
  featured?: boolean | null;
  is_featured?: boolean | null;
  is_new?: boolean | null;
  new_arrival?: boolean | null;
  is_new_arrival?: boolean | null;
  created_at?: string;
}

export interface CartItem {
  id: string;
  user_id: string;
  product_id: string;
  size: string;
  color?: string | null;
  quantity: number;
  product?: Product;
}

export type OrderStatus =
  | "Processing"
  | "Confirmed"
  | "Shipped"
  | "Out for Delivery"
  | "Delivered"
  | "Cancelled";

export interface Order {
  id: string;
  user_id?: string;
  full_name: string;
  phone: string;
  address: string;
  landmark?: string | null;
  city?: string | null;
  zip?: string | null;
  total: number;
  status: OrderStatus;
  payment_method: "GCash" | "Maya" | "Cash on Delivery" | string;
  payment_status: string;
  rider_id?: string | null;
  created_at: string;
  received_at?: string | null;
  confirmed_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  cancelled_at?: string | null;
  items?: OrderItem[];
}

export interface OrderItem {
  id?: string;
  order_id?: string;
  product_id: string;
  size: string;
  quantity: number;
  price: number;
  color?: string | null;
  product?: Pick<Product, "id" | "name" | "image" | "images" | "category">;
}

export interface ProductReview {
  id?: string;
  rating: number;
  comment: string;
  display_name?: string;
  customer_name?: string;
  reviewer_name?: string;
  created_at?: string;
  review_date?: string;
  verified_purchase?: boolean;
}

export interface ReviewEligibility {
  can_review: boolean;
  already_reviewed: boolean;
  message: string;
}

export interface RpcResult {
  success?: boolean;
  message?: string;
  order_id?: string;
  [key: string]: unknown;
}
