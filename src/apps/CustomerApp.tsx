import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Heart,
  Home,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import { Brand } from "../components/common/Brand";
import { EmptyState, ErrorState, LoadingState } from "../components/common/StateView";
import { CheckoutPanel } from "../components/customer/CheckoutPanel";
import { CustomerProfile } from "../components/customer/CustomerProfile";
import { ProductDetails } from "../components/customer/ProductDetails";
import { VirtualTryOn } from "../components/customer/VirtualTryOn";
import { useAuth } from "../contexts/AuthContext";
import { peso, productImage } from "../lib/format";
import { supabase } from "../lib/supabase";
import {
  addCartItem,
  listCart,
  listCustomerOrders,
  listProducts,
  saveWishlist,
  updateCartQuantity,
} from "../services/commerce";
import type { CartItem, Order, Product } from "../types/commerce";

type CustomerView = "home" | "categories" | "wishlist" | "cart" | "profile";
type CustomerProfileTab = "info" | "orders" | "reviews" | "wishlist";

const categories = ["All", "Basics", "Bottoms", "Dresses", "Knitwear", "Outerwear", "Tops"];

export function CustomerApp({
  onSignIn,
  onLogout,
}: {
  onSignIn: () => void;
  onLogout: () => Promise<void>;
}) {
  const { user } = useAuth();
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroTouchStart, setHeroTouchStart] = useState<number | null>(null);
  // Start each fresh CustomerApp session on the Shop Home page.
  // The last visited page is intentionally not restored after a new login.
  const [view, setView] = useState<CustomerView>("home");

  useEffect(() => {
    try {
      localStorage.setItem(`diane-customer-view:${user?.id ?? "guest"}`, view);
    } catch { /* Page persistence is optional; shopping remains available. */ }
  }, [view, user?.id]);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [tryOn, setTryOn] = useState<Product | null>(null);

  useEffect(() => {
    if (!selected) return;
    try {
      localStorage.setItem(`diane-customer-product:${user?.id ?? "guest"}`, selected.id);
    } catch { /* Product restoration is optional if browser storage is unavailable. */ }
  }, [selected, user?.id]);

  const closeSelectedProduct = () => {
    try {
      localStorage.removeItem(`diane-customer-product:${user?.id ?? "guest"}`);
    } catch { /* Ignore unavailable browser storage. */ }
    setSelected(null);
  };
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [profileInitialTab, setProfileInitialTab] = useState<CustomerProfileTab>("info");

  const refreshCustomerData = async () => {
    if (!user) {
      setCart([]);
      setOrders([]);
      return;
    }
    const [cartResult, orderResult] = await Promise.all([
      listCart(user.id),
      listCustomerOrders(user.id),
    ]);
    if (!cartResult.error) setCart(cartResult.data);
    else setNotice(`Unable to load your shopping bag: ${cartResult.error.message}`);
    if (!orderResult.error) setOrders(orderResult.data);
    else setNotice(`Unable to load your orders: ${orderResult.error.message}`);
  };

  useEffect(() => {
    let active = true;
    const productStorageKey = `diane-customer-product:${user?.id ?? "guest"}`;
    setLoading(true);

    listProducts().then(({ data, error: loadError }) => {
      if (!active) return;
      const loadedProducts = (data ?? []) as Product[];
      setProducts(loadedProducts);
      setError(loadError?.message ?? "");
      setLoading(false);

      // Restore the last product for the current account after products finish loading.
      // Keep the saved ID if the request failed; only clear it after a successful
      // product fetch confirms that the product no longer exists.
      if (!loadError) {
        try {
          const savedProductId = localStorage.getItem(productStorageKey);
          if (savedProductId) {
            const savedProduct = loadedProducts.find((item) => item.id === savedProductId);
            if (savedProduct) setSelected(savedProduct);
            else localStorage.removeItem(productStorageKey);
          }
        } catch { /* Product restoration is optional if browser storage is unavailable. */ }
      }
    }).catch((loadError: unknown) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load products.");
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    void refreshCustomerData();
    // Refresh after an auth transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`diane-customer-${user?.id ?? "public"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        void listProducts().then(({ data }) => setProducts((data ?? []) as Product[]));
      });
    if (user) {
      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "cart_items", filter: `user_id=eq.${user.id}` },
          () => void refreshCustomerData(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${user.id}` },
          () => void refreshCustomerData(),
        );
    }
    void channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // The channel is recreated only when the authenticated customer changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const key = user ? `diane-wishlist:${user.id}` : "diane-wishlist:guest";
    const saved = user?.user_metadata?.diane_wishlist;
    if (Array.isArray(saved)) {
      const values = saved.filter((id): id is string => typeof id === "string");
      setWishlist(values);
      try {
        localStorage.setItem(key, JSON.stringify(values));
      } catch {
        // Supabase user metadata remains the primary signed-in wishlist store.
      }
      return;
    }
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      setWishlist(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
    } catch {
      setWishlist([]);
    }
  }, [user?.id]);

  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = products.filter((product) => {
      const categoryMatch = view === "wishlist" || category === "All" || product.category === category;
      const queryMatch =
        !normalized ||
        product.name.toLowerCase().includes(normalized) ||
        product.category?.toLowerCase().includes(normalized);
      const wishlistMatch = view !== "wishlist" || wishlist.includes(product.id);
      return categoryMatch && queryMatch && wishlistMatch;
    });
    return filtered.sort((a, b) => {
      if (sort === "price-low") return Number(a.price) - Number(b.price);
      if (sort === "price-high") return Number(b.price) - Number(a.price);
      if (sort === "rating") return Number(b.rating ?? 0) - Number(a.rating ?? 0);
      return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
    });
  }, [category, products, query, sort, view, wishlist]);

  const toggleWishlist = async (productId: string) => {
    const next = wishlist.includes(productId)
      ? wishlist.filter((id) => id !== productId)
      : [...wishlist, productId];
    setWishlist(next);
    try {
      localStorage.setItem(user ? `diane-wishlist:${user.id}` : "diane-wishlist:guest", JSON.stringify(next));
    } catch {
      // The signed-in wishlist is also stored in Supabase user metadata below.
    }
    if (user) {
      const result = await saveWishlist(next);
      if (result.error) setNotice(`Wishlist could not sync to your account: ${result.error.message}`);
    }
  };

  const addToCart = async (product: Product, size?: string, color?: string) => {
    if (!user) {
      onSignIn();
      return;
    }
    const selectedSize = size || product.sizes?.[0];
    if (!selectedSize) {
      setNotice("Select an available size first.");
      return;
    }
    const result = await addCartItem(user.id, product, selectedSize, color);
    if (result.error) setNotice(result.error.message);
    else {
      setNotice(`${product.name} was added to your bag.`);
      await refreshCustomerData();
    }
  };

  const homeProducts = useMemo(() => {
    const flagged = visibleProducts.filter(
      (product) => product.is_new === true || product.new_arrival === true || product.is_new_arrival === true,
    );
    return (flagged.length > 0 ? flagged : visibleProducts).slice(0, 6);
  }, [visibleProducts]);

  const heroSlides = useMemo(() => {
    const featured = products.slice(0, 3);
    if (featured.length === 0) {
      return [{ image: "/diane/top5.png", eyebrow: "THE NEW EDIT", title: "Quiet confidence,\nmade wearable.", description: "Modern essentials for every version of you.", category: "All" }];
    }
    return featured.map((product, index) => ({
      image: productImage(product.image || product.images?.[0]) || "/diane/top5.png",
      eyebrow: index === 0 ? "THE NEW EDIT" : "DIANE COLLECTION",
      title: product.name,
      description: "Discover a piece made for your everyday style.",
      category: product.category || "All",
    }));
  }, [products]);

  useEffect(() => {
    setHeroIndex(0);
  }, [heroSlides.length]);

  useEffect(() => {
    if (heroSlides.length < 2) return;
    const timer = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroSlides.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [heroSlides.length]);

  const changeHero = (direction: number) => {
    setHeroIndex((current) => (current + direction + heroSlides.length) % heroSlides.length);
  };

  const cartTotal = cart.reduce(
    (total, item) => total + Number(item.product?.price ?? 0) * item.quantity,
    0,
  );

  return (
    <div className="customer-app">
      <header className="customer-header">
        <Brand />
        <button className="bag-button" onClick={() => setView("cart")} aria-label="Shopping bag">
          <ShoppingBag size={21} />
          {cart.length > 0 && <span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>}
        </button>
      </header>


      {view !== "profile" && view !== "cart" && (
        <div className="mobile-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the collection"
          />
          <SlidersHorizontal size={16} />
        </div>
      )}

      <main className="customer-main">
        {view === "home" && (
          <>
            <section
              className="fashion-hero fashion-hero--carousel"
              onTouchStart={(event) => setHeroTouchStart(event.touches[0].clientX)}
              onTouchEnd={(event) => {
                if (heroTouchStart === null) return;
                const delta = heroTouchStart - event.changedTouches[0].clientX;
                if (Math.abs(delta) > 45) changeHero(delta > 0 ? 1 : -1);
                setHeroTouchStart(null);
              }}
            >
              {heroSlides.map((slide, index) => (
                <div key={`${slide.title}-${index}`} className={`fashion-hero__slide ${heroIndex === index ? "active" : ""}`}>
                  <img src={slide.image} alt={slide.title} />
                  <div className="fashion-hero__veil" />
                  <div className="fashion-hero__content">
                    <span>{slide.eyebrow}</span>
                    <h1>{slide.title}</h1>
                    <p>{slide.description}</p>
                    <button className="button button--light" onClick={() => {
                      setCategory(slide.category);
                      setView("categories");
                    }}>EXPLORE COLLECTION</button>
                  </div>
                </div>
              ))}
              {heroSlides.length > 1 && <>
                <button className="fashion-hero__arrow fashion-hero__arrow--left" aria-label="Previous slide" onClick={() => changeHero(-1)}><ArrowLeft size={19} /></button>
                <button className="fashion-hero__arrow fashion-hero__arrow--right" aria-label="Next slide" onClick={() => changeHero(1)}><ChevronRight size={19} /></button>
                <div className="fashion-hero__dots">
                  {heroSlides.map((slide, index) => <button key={`${slide.title}-dot`} className={heroIndex === index ? "active" : ""} aria-label={`Go to slide ${index + 1}`} onClick={() => setHeroIndex(index)} />)}
                </div>
              </>}
            </section>

            <section className="category-strip" aria-label="Categories">
              {categories.slice(1).map((item) => (
                <button
                  key={item}
                  onClick={() => {
                    setCategory(item);
                    setView("categories");
                  }}
                >
                  <span>{item.slice(0, 2).toUpperCase()}</span>
                  {item}
                </button>
              ))}
            </section>

            <section className="section-heading-row">
              <div>
                <span className="eyebrow">JUST IN</span>
                <h2>New arrivals</h2>
              </div>
              <button onClick={() => setView("categories")}>
                VIEW ALL <ChevronRight size={14} />
              </button>
            </section>
          </>
        )}

        {view === "categories" && (
          <section className="catalog-heading">
            <span className="eyebrow">DIANE COLLECTION</span>
            <h1>Shop all</h1>
            <label className="catalog-sort">
              SORT
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="newest">Newest</option>
                <option value="price-low">Price: Low to high</option>
                <option value="price-high">Price: High to low</option>
                <option value="rating">Top rated</option>
              </select>
            </label>
            <div className="filter-row">
              {categories.map((item) => (
                <button
                  className={category === item ? "active" : ""}
                  key={item}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </section>
        )}

        {view === "wishlist" && (
          <section className="catalog-heading">
            <span className="eyebrow">SAVED FOR LATER</span>
            <h1>Your wishlist</h1>
            <p>
              {user
                ? "Pieces you love, securely saved with your DIANE account."
                : "Sign in to sync saved pieces across your future sessions."}
            </p>
          </section>
        )}

        {(view === "home" || view === "categories" || view === "wishlist") && (
          <>
            {loading && <LoadingState label="Curating the collection" />}
            {error && <ErrorState message={error} />}
            {!loading && !error && visibleProducts.length === 0 && (
              <EmptyState
                title={view === "wishlist" ? "Your wishlist is waiting" : "No pieces found"}
                body={
                  view === "wishlist"
                    ? "Tap the heart on any piece to save it here."
                    : "Try a different category or search."
                }
              />
            )}
            {!loading && !error && (
              <section className="product-grid">
                {(view === "home" ? homeProducts : visibleProducts).map((product) => (
                  <article className="product-card" key={product.id}>
                    <button className="product-image" onClick={() => setSelected(product)}>
                      <img
                        src={productImage(product.image || product.images?.[0])}
                        alt={product.name}
                      />
                      {(product.new_arrival || product.is_new_arrival) && <span>NEW</span>}
                    </button>
                    <button
                      className={`heart-button ${wishlist.includes(product.id) ? "active" : ""}`}
                      onClick={() => void toggleWishlist(product.id)}
                      aria-label="Save to wishlist"
                    >
                      <Heart
                        size={18}
                        fill={wishlist.includes(product.id) ? "currentColor" : "none"}
                      />
                    </button>
                    <div className="product-meta">
                      <button onClick={() => setSelected(product)}>{product.name}</button>
                      <span>{product.category}</span>
                      <div>
                        <strong>{peso.format(product.price)}</strong>
                        {product.original_price && <del>{peso.format(product.original_price)}</del>}
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}

        {view === "cart" && (
          <section className="bag-page">
            <button className="text-button" onClick={() => setView("home")}>
              <ArrowLeft size={16} /> Continue shopping
            </button>
            <div className="bag-title">
              <span className="eyebrow">YOUR SELECTION</span>
              <h1>Shopping bag</h1>
              <p>
                {cart.length} {cart.length === 1 ? "piece" : "pieces"}
              </p>
            </div>
            {!user ? (
              <EmptyState
                title="Sign in to view your bag"
                body="Your saved bag is securely linked to your DIANE account."
              />
            ) : cart.length === 0 ? (
              <EmptyState title="Your bag is empty" body="Explore the latest DIANE collection." />
            ) : (
              <>
                <div className="cart-list">
                  {cart.map((item) => (
                    <article key={item.id}>
                      <img
                        src={productImage(item.product?.image || item.product?.images?.[0])}
                        alt=""
                      />
                      <div>
                        <h3>{item.product?.name}</h3>
                        <p>
                          Size {item.size}
                          {item.color ? ` · ${item.color}` : ""}
                        </p>
                        <strong>{peso.format(Number(item.product?.price ?? 0))}</strong>
                        <div className="quantity-control">
                          <button
                            aria-label="Decrease quantity"
                            onClick={async () => {
                              const result = await updateCartQuantity(item.id, item.quantity - 1, item.product?.stock);
                              if (result.error) setNotice(result.error.message);
                              await refreshCustomerData();
                            }}
                          >
                            <Minus size={14} />
                          </button>
                          <span>{item.quantity}</span>
                          <button
                            aria-label="Increase quantity"
                            onClick={async () => {
                              const result = await updateCartQuantity(item.id, item.quantity + 1, item.product?.stock);
                              if (result.error) setNotice(result.error.message);
                              await refreshCustomerData();
                            }}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                      <strong>
                        {peso.format(Number(item.product?.price ?? 0) * item.quantity)}
                      </strong>
                    </article>
                  ))}
                </div>
                <aside className="bag-summary">
                  <span>Subtotal</span>
                  <strong>{peso.format(cartTotal)}</strong>
                  <p>Delivery fees are calculated at checkout.</p>
                  <button
                    className="button button--dark button--full"
                    onClick={() => setCheckoutOpen(true)}
                  >
                    SECURE CHECKOUT
                  </button>
                </aside>
              </>
            )}
          </section>
        )}

        {view === "profile" && (
          <section className="profile-page">
            {!user ? (
              <div className="profile-signin">
                <span className="eyebrow">YOUR DIANE</span>
                <h1>A more personal shopping experience.</h1>
                <p>Sign in to see orders, saved delivery details, and your wishlist.</p>
                <button className="button button--dark" onClick={onSignIn}>
                  SIGN IN OR REGISTER
                </button>
              </div>
            ) : (
              <CustomerProfile
                orders={orders}
                products={products}
                initialTab={profileInitialTab}
                wishlist={wishlist}
                onOpenProduct={setSelected}
                onRefreshOrders={refreshCustomerData}
                onNotice={setNotice}
                onLogout={onLogout}
              />
            )}
          </section>
        )}
      </main>

      <nav className="customer-bottom-nav">
        {[
          ["home", Home, "Home"],
          ["categories", Search, "Categories"],
          ["wishlist", Heart, "Wishlist"],
          ["cart", ShoppingBag, "Cart"],
          ["profile", UserRound, "Profile"],
        ].map(([key, Icon, label]) => (
          <button
            key={String(key)}
            className={view === key ? "active" : ""}
            onClick={() => {
              const nextView = key as CustomerView;
              if (nextView === "home" || nextView === "categories") setCategory("All");
              setView(nextView);
            }}
          >
            <Icon size={20} />
            <span>{String(label)}</span>
          </button>
        ))}
      </nav>

      {selected && (
        <ProductDetails
          product={selected}
          wished={wishlist.includes(selected.id)}
          onClose={closeSelectedProduct}
          onWishlist={() => void toggleWishlist(selected.id)}
          onAddToCart={(size, color) => addToCart(selected, size, color)}
          onTryOn={() => setTryOn(selected)}
        />
      )}

      {checkoutOpen && (
        <CheckoutPanel
          cart={cart}
          onClose={() => setCheckoutOpen(false)}
          onViewOrders={() => {
            setCheckoutOpen(false);
            setProfileInitialTab("orders");
            setView("profile");
          }}
          onComplete={refreshCustomerData}
        />
      )}

          {tryOn?.tryon_image && (
        <VirtualTryOn
          garmentUrl={tryOn.tryon_image}
          productName={tryOn.name}
          category={tryOn.category ?? ""}
          onClose={() => setTryOn(null)}
        />
      )}

      {notice && (
        <div className="toast">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
