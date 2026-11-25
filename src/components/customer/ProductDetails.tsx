import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Camera, Check, Heart, ShieldCheck, Star, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { peso, philippineDate, productImage } from "../../lib/format";
import { getProductReviews, getReviewEligibility, submitReview } from "../../services/commerce";
import type { Product, ProductReview, ReviewEligibility } from "../../types/commerce";
import { clearFormDraft, restoreFormDraft, saveFormDraft } from "../../lib/formDraft";
import { EmptyState, LoadingState } from "../common/StateView";

interface ProductDetailsProps {
  product: Product;
  wished: boolean;
  onClose: () => void;
  onWishlist: () => void;
  onAddToCart: (size: string, color?: string) => Promise<void>;
  onTryOn: () => void;
}

const viewLabels = ["Front", "Back", "Side"];

export function ProductDetails({
  product,
  wished,
  onClose,
  onWishlist,
  onAddToCart,
  onTryOn,
}: ProductDetailsProps) {
  const { user } = useAuth();
  const [activeView, setActiveView] = useState(0);
  const [size, setSize] = useState(product.sizes?.[0] ?? "");
  const colors = useMemo(
    () =>
      Array.isArray(product.colors)
        ? product.colors
        : product.colors
          ? [product.colors]
          : [],
    [product.colors],
  );
  const [color, setColor] = useState(colors[0] ?? "");
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [eligibility, setEligibility] = useState<ReviewEligibility | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const reviewFormRef = useRef<HTMLFormElement>(null);
  const reviewDraftKey = user ? `diane:customer:${user.id}:review:${product.id}:draft` : null;
  const [reviewDraftRestored, setReviewDraftRestored] = useState(false);

  useEffect(() => {
    if (!reviewOpen || !reviewFormRef.current) return;
    setReviewDraftRestored(restoreFormDraft(reviewDraftKey, reviewFormRef.current));
  }, [reviewOpen, reviewDraftKey]);

  useEffect(() => {
    setActiveView(0);
    setSize(product.sizes?.[0] ?? "");
    setColor(colors[0] ?? "");
    setReviewOpen(false);
    setReviewMessage("");
  }, [product.id, product.sizes, colors]);

  const gallery = useMemo(() => {
    const existing = product.images ?? [];
    return [product.image || existing[0] || null, existing[1] || null, existing[2] || null];
  }, [product]);

  const loadReviews = async () => {
    setReviewsLoading(true);
    const reviewResult = await getProductReviews(product.id);
    setReviews(reviewResult.data);
    if (user) {
      const statusResult = await getReviewEligibility(product.id);
      setEligibility(statusResult.data);
    } else {
      setEligibility(null);
    }
    setReviewsLoading(false);
  };

  useEffect(() => {
    void loadReviews();
    // Review eligibility changes with the signed-in account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, user?.id]);

  const distribution = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: reviews.filter((review) => Number(review.rating) === rating).length,
  }));
  const averageReviewRating = reviews.length
    ? reviews.reduce((total, review) => total + Number(review.rating), 0) / reviews.length
    : Number(product.rating ?? 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rating = Number(form.get("rating"));
    const comment = String(form.get("comment") ?? "").trim();
    if (rating < 1 || rating > 5 || comment.length < 5 || comment.length > 1000) {
      setReviewMessage("Choose 1–5 stars and write between 5 and 1,000 characters.");
      return;
    }
    const result = await submitReview(product.id, rating, comment);
    const payload = Array.isArray(result.data) ? result.data[0] : result.data;
    if (result.error || !payload?.success) {
      setReviewMessage(result.error?.message ?? payload?.message ?? "The review was not accepted.");
      return;
    }
    clearFormDraft(reviewDraftKey);
    setReviewDraftRestored(false);
    setReviewMessage("Thank you. Your verified review has been submitted.");
    setReviewOpen(false);
    await loadReviews();
  };

  return (
    <div className="product-drawer-backdrop" onClick={onClose}>
      <article
        className="product-drawer product-drawer--complete"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="icon-button product-drawer__close"
          onClick={onClose}
          aria-label="Close product"
        >
          <X />
        </button>
        <div className="gallery-viewer">
          <div className="gallery-main">
            {gallery[activeView] ? (
              <img
                src={productImage(gallery[activeView])}
                alt={`${product.name} ${viewLabels[activeView]} view`}
              />
            ) : (
              <div className="image-unavailable">
                <span>{viewLabels[activeView].toUpperCase()} VIEW</span>
                <strong>Image unavailable</strong>
                <p>This view has not been uploaded for this product.</p>
              </div>
            )}
          </div>
          <div className="gallery-thumbnails">
            {gallery.map((image, index) => (
              <button
                key={viewLabels[index]}
                className={activeView === index ? "active" : ""}
                onClick={() => setActiveView(index)}
                aria-label={`Show ${viewLabels[index]} view`}
              >
                {image ? <img src={image} alt="" /> : <span>{viewLabels[index].slice(0, 1)}</span>}
                <small>{viewLabels[index]}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="product-detail">
          <span className="eyebrow">{product.category}</span>
          <div className="product-title-row">
            <h2>{product.name}</h2>
            <button
              className={wished ? "active" : ""}
              onClick={onWishlist}
              aria-label="Toggle wishlist"
            >
              <Heart fill={wished ? "currentColor" : "none"} />
            </button>
          </div>
          <div className="product-price">
            <strong>{peso.format(product.price)}</strong>
            {product.original_price && <del>{peso.format(product.original_price)}</del>}
          </div>
          <button
            className="rating-link"
            onClick={() => document.getElementById("product-reviews")?.scrollIntoView()}
          >
            <Star size={14} fill="currentColor" /> {averageReviewRating.toFixed(1)} ·{" "}
            {reviews.length || product.review_count || 0} reviews
          </button>
          <p>{product.description || "Product description is currently unavailable."}</p>
          {product.material && <small>MATERIAL · {product.material}</small>}
          <div className="stock-line">
            <Check size={14} /> {product.stock > 0 ? `${product.stock} available` : "Out of stock"}
          </div>

          <fieldset className="option-fieldset">
            <legend>SELECT SIZE</legend>
            <div className="size-row">
              {(product.sizes ?? []).map((item) => (
                <button
                  className={size === item ? "active" : ""}
                  type="button"
                  key={item}
                  onClick={() => setSize(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </fieldset>
          {colors.length > 0 && (
            <fieldset className="option-fieldset">
              <legend>SELECT COLOR</legend>
              <div className="color-row">
                {colors.map((item) => (
                  <button
                    className={color === item ? "active" : ""}
                    type="button"
                    key={item}
                    onClick={() => setColor(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <button
            className="button button--dark button--full"
            disabled={product.stock < 1 || !size || (colors.length > 0 && !color)}
            onClick={() => onAddToCart(size, color || undefined)}
          >
            {product.stock > 0 ? "ADD TO BAG" : "OUT OF STOCK"}
          </button>
          {product.tryon_image && (
            <button className="button button--outline button--full" onClick={onTryOn}>
              <Camera size={17} /> LIVE VIRTUAL TRY-ON
            </button>
          )}
          <p className="product-security">
            <ShieldCheck size={14} /> Secure checkout and Supabase-protected account data
          </p>
        </div>

        <section className="product-reviews" id="product-reviews">
          <div className="reviews-heading">
            <div>
              <span className="eyebrow">VERIFIED CUSTOMER FEEDBACK</span>
              <h3>Reviews & ratings</h3>
            </div>
            {eligibility?.can_review && (
              <button
                className="button button--outline"
                onClick={() => setReviewOpen((value) => !value)}
              >
                WRITE A REVIEW
              </button>
            )}
          </div>
          <div className="rating-summary">
            <div>
              <strong>{averageReviewRating.toFixed(1)}</strong>
              <span>OUT OF 5</span>
            </div>
            <div className="rating-distribution">
              {distribution.map((row) => (
                <div key={row.rating}>
                  <span>
                    {row.rating} <Star size={10} fill="currentColor" />
                  </span>
                  <i>
                    <b
                      style={{
                        width: `${reviews.length ? (row.count / reviews.length) * 100 : 0}%`,
                      }}
                    />
                  </i>
                  <small>{row.count}</small>
                </div>
              ))}
            </div>
          </div>
          {reviewOpen && (
            <form
              ref={reviewFormRef}
              className="review-form"
              onSubmit={submit}
              onInput={(event) => saveFormDraft(reviewDraftKey, event.currentTarget)}
              onChange={(event) => saveFormDraft(reviewDraftKey, event.currentTarget)}
            >
              <label>
                Rating
                <select name="rating" defaultValue="5">
                  {[5, 4, 3, 2, 1].map((value) => (
                    <option key={value} value={value}>
                      {value} stars
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Review
                <textarea
                  name="comment"
                  minLength={5}
                  maxLength={1000}
                  required
                  placeholder="Share your experience with this product."
                />
              </label>
              <small className="field-help">
                {reviewDraftRestored
                  ? "Your unfinished review was restored from this device."
                  : "Your unfinished review is saved automatically on this device until submission."}
              </small>
              <button className="button button--dark">SUBMIT REVIEW</button>
            </form>
          )}
          {reviewMessage && <div className="form-message">{reviewMessage}</div>}
          {!user && <p className="review-eligibility">Sign in to check review eligibility.</p>}
          {user && eligibility && !eligibility.can_review && (
            <p className="review-eligibility">{eligibility.message}</p>
          )}
          {reviewsLoading ? (
            <LoadingState label="Loading verified reviews" />
          ) : reviews.length === 0 ? (
            <EmptyState title="No reviews yet" body="Verified customer reviews will appear here." />
          ) : (
            <div className="review-list">
              {reviews.map((review, index) => (
                <article key={review.id ?? index}>
                  <div>
                    <strong>
                      {review.display_name || review.customer_name || "DIANE Customer"}
                    </strong>
                    <span>
                      {Array.from({ length: 5 }, (_, star) => (
                        <Star
                          key={star}
                          size={12}
                          fill={star < review.rating ? "currentColor" : "none"}
                        />
                      ))}
                    </span>
                  </div>
                  <p>{review.comment}</p>
                  <footer>
                    <span>
                      {review.created_at || review.review_date
                        ? philippineDate.format(new Date(review.created_at || review.review_date!))
                        : ""}
                    </span>
                    {review.verified_purchase && (
                      <b>
                        <Check size={11} /> Verified purchase
                      </b>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      </article>
    </div>
  );
}
